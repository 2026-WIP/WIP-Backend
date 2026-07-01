$ErrorActionPreference = 'Stop'

$mysql = (Get-Command mysql.exe -ErrorAction Stop).Source
$mysqld = (Get-Command mysqld.exe -ErrorAction Stop).Source
$backendRoot = Split-Path -Parent $PSScriptRoot

function Get-DotEnvValue($name) {
  $envPath = Join-Path $backendRoot '.env'
  if (-not (Test-Path $envPath)) { return $null }

  foreach ($line in Get-Content $envPath) {
    if ($line -match "^\s*$([regex]::Escape($name))\s*=\s*(.+?)\s*$") {
      return $Matches[1].Trim('"').Trim("'")
    }
  }

  return $null
}

function Escape-SqlString($value) {
  return [string]$value -replace "'", "''"
}

function Escape-SqlIdentifier($value) {
  return ([string]$value -replace "``", "````")
}

$databaseUrl = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { Get-DotEnvValue 'DATABASE_URL' }
if (-not $databaseUrl) {
  $databaseUrl = 'mysql://wip:wip_password@127.0.0.1:3306/wip_dev'
}

$uri = [System.Uri]$databaseUrl
$hostName = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 3306 }
$databaseName = $uri.AbsolutePath.TrimStart('/')
$userInfo = $uri.UserInfo.Split(':', 2)
$databaseUser = [System.Uri]::UnescapeDataString($userInfo[0])
$databasePassword = if ($userInfo.Length -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { '' }

if (-not $databaseName) { throw 'DATABASE_URL must include a database name.' }
if (-not $databaseUser) { throw 'DATABASE_URL must include a user name.' }

$localHosts = @('localhost', '127.0.0.1', '::1')
if ($localHosts -notcontains $hostName) {
  Write-Host "DATABASE_URL points to $hostName, so no local MySQL process was started."
  exit 0
}

$dataDir = Join-Path $env:LOCALAPPDATA "WIP\mysql-data-$port"

if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir | Out-Null
  & $mysqld --initialize-insecure "--datadir=$dataDir"
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to initialize the local MySQL data directory.'
  }
}

$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if (-not $listening) {
  $arguments = @(
    '--no-defaults'
    "`"--datadir=$dataDir`""
    "--port=$port"
    '--bind-address=127.0.0.1'
    "`"--log-error=$dataDir\local-mysql.err`""
    "`"--pid-file=$dataDir\local-mysql.pid`""
    '--console'
  )
  Start-Process -FilePath $mysqld `
    -ArgumentList $arguments `
    -WorkingDirectory $backendRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $backendRoot 'local-mysql.stdout.log') `
    -RedirectStandardError (Join-Path $backendRoot 'local-mysql.stderr.log')

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    $listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listening) { break }
  }
}

if (-not $listening) {
  throw "Local MySQL did not start on port $port."
}

$db = Escape-SqlIdentifier $databaseName
$user = Escape-SqlString $databaseUser
$password = Escape-SqlString $databasePassword
$sql = @"
CREATE DATABASE IF NOT EXISTS ``$db`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$user'@'localhost' IDENTIFIED BY '$password';
CREATE USER IF NOT EXISTS '$user'@'127.0.0.1' IDENTIFIED BY '$password';
ALTER USER '$user'@'localhost' IDENTIFIED BY '$password';
ALTER USER '$user'@'127.0.0.1' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON ``$db``.* TO '$user'@'localhost';
GRANT ALL PRIVILEGES ON ``$db``.* TO '$user'@'127.0.0.1';
FLUSH PRIVILEGES;
"@

& $mysql --protocol=tcp --host=127.0.0.1 "--port=$port" --user=root `
  --execute="$sql"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to prepare the $databaseName database."
}

Write-Host "Local MySQL is ready on 127.0.0.1:$port for database '$databaseName'."
