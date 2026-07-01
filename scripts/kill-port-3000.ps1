$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
$processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)

if ($processIds.Count -eq 0) {
    Write-Host "Port 3000 is already free."
    exit 0
}

foreach ($procId in $processIds) {
    $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $process) {
        Write-Host "PID $procId already exited."
        continue
    }

    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "Killed PID $procId (was holding port 3000)"
}
