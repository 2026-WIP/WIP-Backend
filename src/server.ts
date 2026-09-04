import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFile, spawn, type ExecFileException } from 'node:child_process';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDatabaseConnection } from './db.js';
import { seedUser, store } from './store.js';
import type { RunnerResult, User } from './types.js';

// ─── Code Runner ─────────────────────────────────────────────────────────────
function executeCode(language: string, code: string): RunnerResult {
  const start = Date.now();

  if (language === 'javascript' || language === 'typescript') {
    const lines: string[] = [];
    const ctx = vm.createContext({
      console: {
        log: (...a: unknown[]) => lines.push(a.map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' ')),
        error: (...a: unknown[]) => lines.push('[error] ' + a.map(String).join(' ')),
        warn: (...a: unknown[]) => lines.push('[warn] ' + a.map(String).join(' ')),
      },
      Math, JSON, Array, Object, String, Number, Boolean, Date, RegExp,
      parseInt, parseFloat, isNaN, isFinite, undefined,
    });
    try {
      vm.runInContext(language === 'typescript' ? code.replace(/:\s*\w+(\[\])?/g, '') : code, ctx, { timeout: 3000 });
      return { stdout: lines.join('\n') || '(출력 없음)', stderr: '', exitCode: 0, durationMs: Date.now() - start, compiler: 'built-in JavaScript VM' };
    } catch (e) {
      return { stdout: lines.join('\n'), stderr: String(e), exitCode: 1, durationMs: Date.now() - start, compiler: 'built-in JavaScript VM' };
    }
  }

  // 다른 언어는 변수 추적 + print/println/echo 패턴 시뮬레이션
  const simulators: Record<string, (c: string) => string> = {
    python: (c) => {
      const out: string[] = [];
      const vars: Record<string, string> = {};
      for (const m of c.matchAll(/^\s*(\w+)\s*=\s*(.+)$/gm)) {
        vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      for (const line of c.split('\n')) {
        const m = line.match(/^\s*print\s*\(\s*([\s\S]*?)\s*\)\s*$/);
        if (!m) continue;
        const arg = m[1].trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
          out.push(arg.slice(1, -1));
        } else if (arg in vars) {
          out.push(vars[arg]);
        } else {
          out.push(arg);
        }
      }
      return out.join('\n') || '(출력 없음)';
    },
    java: (c) => {
      const out: string[] = [];
      const vars: Record<string, string> = {};
      // 기본 타입 변수 선언 파싱
      for (const m of c.matchAll(/\b(?:int|long|short|byte)\s+(\w+)\s*=\s*(-?\d+)/g)) vars[m[1]] = m[2];
      for (const m of c.matchAll(/\bfloat\s+(\w+)\s*=\s*(-?[\d.]+)f?/gi)) vars[m[1]] = m[2];
      for (const m of c.matchAll(/\bdouble\s+(\w+)\s*=\s*(-?[\d.]+)/g)) vars[m[1]] = m[2];
      for (const m of c.matchAll(/\bboolean\s+(\w+)\s*=\s*(true|false)/g)) vars[m[1]] = m[2];
      for (const m of c.matchAll(/\bchar\s+(\w+)\s*=\s*'(.)'/g)) vars[m[1]] = m[2];
      for (const m of c.matchAll(/\bString\s+(\w+)\s*=\s*"([^"]*)"/g)) vars[m[1]] = m[2];
      // System.out.println / System.out.print 처리 (변수명에 공백 포함 허용)
      for (const m of c.matchAll(/System\s*\.\s*out\s*\.\s*print(?:ln)?\s*\(\s*([\s\S]*?)\s*\)\s*;/g)) {
        const arg = m[1].trim();
        if (arg.startsWith('"') && arg.endsWith('"')) {
          out.push(arg.slice(1, -1));
        } else if (arg.startsWith("'") && arg.endsWith("'") && arg.length === 3) {
          out.push(arg[1]);
        } else {
          const varName = arg.replace(/\s/g, '');
          out.push(varName in vars ? vars[varName] : arg);
        }
      }
      return out.join('\n') || '(출력 없음)';
    },
    bash: (c) => {
      const out: string[] = [];
      for (const line of c.split('\n')) {
        const m = line.match(/^\s*echo\s+(.+)/);
        if (m) out.push(m[1].replace(/['"]/g, ''));
      }
      return out.join('\n') || '(출력 없음)';
    },
  };

  const fn = simulators[language];
  const stdout = fn ? fn(code) : `[${language}] 실행 완료`;
  return { stdout, stderr: '', exitCode: 0, durationMs: Math.floor(Math.random() * 180) + 20, compiler: 'built-in simulator' };
}

// Locate the built frontend (works for both tsx src/ and compiled dist/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '..', '..', 'WIP-Frontend', 'dist');
const hasFrontend = existsSync(frontendDist);
const terminalRoot = resolve(process.env.TERMINAL_CWD ?? join(__dirname, '..', '..'));
const terminalCwds = {
  root: terminalRoot,
  frontend: resolve(terminalRoot, 'WIP-Frontend'),
  backend: resolve(terminalRoot, 'WIP-Backend'),
} as const;
type TerminalCwdKey = keyof typeof terminalCwds;

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT ?? 3000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const isProduction = process.env.NODE_ENV === 'production';
const serverSessionId = crypto.randomBytes(16).toString('hex');
const activeRefreshTokens = new Set<string>();

await verifyDatabaseConnection();

if (!isProduction) {
  const defaultSeedUsers = [
    'test@gmail.com:password123:Test User',
    'test7@gmail.com:password123:Test Seven',
  ];
  const seedUsers = (process.env.DEV_SEED_USERS?.split(',') ?? defaultSeedUsers)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of seedUsers) {
    const [email, password = 'password123', nickname = 'Dev User'] = entry.split(':');
    if (email) await seedUser(email, password, nickname);
  }
}

const io = new Server(httpServer, {
  cors: { origin: clientOrigin, credentials: true },
});

function readCookie(rawCookies: string | undefined, name: string) {
  const prefix = `${name}=`;
  return rawCookies?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length);
}

io.use(async (socket, next) => {
  try {
    const token = readCookie(socket.handshake.headers.cookie, 'wip_token');
    if (!token) throw new Error('Missing access token.');
    const payload = jwt.verify(token, jwtSecret) as { email?: string; sid?: string };
    if (!payload.email || payload.sid !== serverSessionId) throw new Error('Invalid access token.');
    const user = await store.getUserByEmail(payload.email);
    if (!user) throw new Error('User not found.');
    socket.data.userId = user.id;
    next();
  } catch {
    next(new Error('Not authenticated.'));
  }
});

// 온라인 유저 추적
const onlineUsers = new Map<string, Set<string>>(); // userId -> Set of socketIds

io.on('connection', (socket) => {
  const userId = socket.data.userId as string;
  socket.join(`user:${userId}`);

  // 온라인 상태 등록
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId)!.add(socket.id);
  io.emit('presence:update', { userId, online: true });

  socket.on('channel:join', async (channelId: string) => {
    if (await store.canAccessChannel(channelId, userId)) {
      socket.join(`channel:${channelId}`);
    }
  });

  socket.on('channel:leave', (channelId: string) => {
    socket.leave(`channel:${channelId}`);
  });

  // 타이핑 이벤트
  socket.on('typing:start', (channelId: string) => {
    socket.to(`channel:${channelId}`).emit('typing:update', { channelId, userId, typing: true });
  });

  socket.on('typing:stop', (channelId: string) => {
    socket.to(`channel:${channelId}`).emit('typing:update', { channelId, userId, typing: false });
  });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        io.emit('presence:update', { userId, online: false });
      }
    }
  });
});

interface AuthRequest extends Request {
  user?: User;
}

function signToken(user: User) {
  return jwt.sign({ sub: user.id, email: user.email, sid: serverSessionId }, jwtSecret, { expiresIn: '7d' });
}

const cookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? 'none' as const : 'lax' as const,
  secure: isProduction,
};

function setAccessCookie(res: Response, user: User) {
  res.cookie('wip_token', signToken(user), {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex');
}

async function setAuthCookie(res: Response, user: User) {
  const refreshToken = generateRefreshToken();
  activeRefreshTokens.add(refreshToken);
  await store.storeRefreshToken(refreshToken, user.id);

  setAccessCookie(res, user);
  res.cookie('wip_refresh', refreshToken, {
    ...cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
  });
}

async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.wip_token;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as { email?: string; sid?: string };
    if (!payload.email || payload.sid !== serverSessionId) throw new Error('Invalid token.');
    const user = await store.getUserByEmail(payload.email);
    if (!user) throw new Error('User not found.');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated.' });
  }
}

function handleError(res: Response, error: unknown, status = 400) {
  res.status(status).json({ error: error instanceof Error ? error.message : 'Request failed.' });
}

function runProcess(
  file: string,
  args: string[],
  options: { cwd: string; timeout?: number; stdin?: string; env?: NodeJS.ProcessEnv; compiler?: string },
): Promise<RunnerResult> {
  const startedAt = Date.now();

  return new Promise((resolveResult) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      stderr += `${stderr ? '\n' : ''}Process timed out after ${(options.timeout ?? 15000) / 1000} seconds.`;
      child.kill();
    }, options.timeout ?? 15000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const missingTool = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `${file} 명령을 찾을 수 없습니다. ${options.compiler ?? file} 실행 도구를 설치하고 PATH에 추가하세요.`
        : error.message;
      resolveResult({ stdout, stderr: `${stderr}${stderr ? '\n' : ''}${missingTool}`, exitCode: 1, durationMs: Date.now() - startedAt, compiler: options.compiler });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({ stdout, stderr, exitCode: code ?? 1, durationMs: Date.now() - startedAt, compiler: options.compiler });
    });

    const stdin = options.stdin ?? '';
    child.stdin.end(stdin && !stdin.endsWith('\n') ? `${stdin}\n` : stdin);
  });
}

const javaUtf8Args = ['-Dfile.encoding=UTF-8', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8'];

async function executeStandaloneCode(language: string, code: string, stdin = ''): Promise<RunnerResult> {
  if (!language || !code.trim()) throw new Error('language and code are required.');
  if (code.length > 100_000) throw new Error('Code is too long.');
  if (stdin.length > 20_000) throw new Error('Input is too long.');

  if (language === 'javascript') {
    const dir = await mkdtemp(join(tmpdir(), 'wip-run-'));
    const file = join(dir, 'snippet.mjs');
    try {
      await writeFile(file, code, 'utf8');
      return await runProcess('node', [file], { cwd: dir, stdin, compiler: 'Node.js' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (language === 'typescript') {
    const dir = await mkdtemp(join(tmpdir(), 'wip-run-'));
    const file = join(dir, 'snippet.ts');
    const tsxBin = process.platform === 'win32'
      ? resolve(__dirname, '..', 'node_modules', '.bin', 'tsx.cmd')
      : resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');
    try {
      await writeFile(file, code, 'utf8');
      if (!existsSync(tsxBin)) throw new Error('TypeScript execution requires tsx.');
      return await runProcess(tsxBin, [file], { cwd: dir, stdin, compiler: 'tsx + Node.js' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (language === 'python') {
    const dir = await mkdtemp(join(tmpdir(), 'wip-run-'));
    const file = join(dir, 'snippet.py');
    try {
      await writeFile(file, code, 'utf8');
      return await runProcess(process.platform === 'win32' ? 'python' : 'python3', [file], { cwd: dir, stdin, compiler: 'Python' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (language === 'java') {
    const dir = await mkdtemp(join(tmpdir(), 'wip-run-'));
    const mainClass = code.match(/\bpublic\s+class\s+([A-Za-z_$][\w$]*)/)?.[1]
      ?? code.match(/\bclass\s+([A-Za-z_$][\w$]*)/)?.[1]
      ?? 'Main';
    const file = join(dir, `${mainClass}.java`);
    try {
      await writeFile(file, code, 'utf8');
      const compile = await runProcess('javac', ['-encoding', 'UTF-8', file], { cwd: dir, timeout: 15000, compiler: 'javac' });
      if (compile.exitCode !== 0) return compile;
      return await runProcess('java', [...javaUtf8Args, '-cp', dir, mainClass], { cwd: dir, stdin, timeout: 15000, compiler: 'javac + java' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  if (language === 'bash') {
    const dir = await mkdtemp(join(tmpdir(), 'wip-run-'));
    const file = join(dir, process.platform === 'win32' ? 'snippet.ps1' : 'snippet.sh');
    try {
      await writeFile(file, code, 'utf8');
      return process.platform === 'win32'
        ? await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: dir, stdin, compiler: 'PowerShell' })
        : await runProcess('/bin/sh', [file], { cwd: dir, stdin, compiler: 'sh' });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return executeCode(language, code);
}

function getTerminalCwd(cwdKey: unknown) {
  const key = typeof cwdKey === 'string' && cwdKey in terminalCwds ? cwdKey as TerminalCwdKey : 'root';
  const cwd = terminalCwds[key];
  if (!cwd.startsWith(terminalRoot)) throw new Error('Invalid terminal working directory.');
  if (!existsSync(cwd)) throw new Error(`Terminal path not found: ${key}`);
  return { key, cwd };
}

function runTerminalCommand(command: string, cwdKey?: unknown): Promise<{ stdout: string; stderr: string; exitCode: number; cwd: string; cwdKey: TerminalCwdKey; durationMs: number }> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Command is required.');
  if (trimmed.length > 1000) throw new Error('Command is too long.');

  const startedAt = Date.now();
  const { key, cwd } = getTerminalCwd(cwdKey);
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', trimmed]
    : ['-lc', trimmed];

  return new Promise((resolveResult) => {
    execFile(shell, args, {
      cwd,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
      const timedOut = error?.killed && error.signal === 'SIGTERM';
      resolveResult({
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}Command timed out after 15 seconds.` : stderr,
        exitCode,
        cwd,
        cwdKey: key,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function isInside(parent: string, child: string) {
  const relativePath = resolve(child).slice(resolve(parent).length);
  return relativePath === '' || /^[\\/]/.test(relativePath);
}

function getProjectCodeExtension(language: string, fileName?: string) {
  const fromFile = fileName ? extname(fileName).toLowerCase() : '';
  if (fromFile) return fromFile;
  if (language === 'typescript') return '.ts';
  if (language === 'python') return '.py';
  if (language === 'bash') return process.platform === 'win32' ? '.ps1' : '.sh';
  return '.mjs';
}

function getProjectCodeRunner(language: string, filePath: string, cwd: string) {
  if (language === 'javascript') return { file: 'node', args: [filePath], compiler: 'Node.js' };

  if (language === 'typescript') {
    const bin = process.platform === 'win32'
      ? resolve(cwd, 'node_modules', '.bin', 'tsx.cmd')
      : resolve(cwd, 'node_modules', '.bin', 'tsx');
    if (!existsSync(bin)) {
      throw new Error('TypeScript 프로젝트 실행에는 선택한 위치에 tsx가 필요합니다. Backend 위치에는 기본 포함되어 있습니다.');
    }
    return { file: bin, args: [filePath], compiler: 'tsx + Node.js' };
  }

  if (language === 'python') {
    return { file: process.platform === 'win32' ? 'python' : 'python3', args: [filePath], compiler: 'Python' };
  }

  if (language === 'bash') {
    return process.platform === 'win32'
      ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', filePath], compiler: 'PowerShell' }
      : { file: '/bin/sh', args: [filePath], compiler: 'sh' };
  }

  throw new Error('Project execution supports JavaScript, TypeScript, Python, and shell code.');
}

async function executeProjectCode(input: {
  language?: string;
  code?: string;
  fileName?: string;
  cwdKey?: string;
  stdin?: string;
}): Promise<RunnerResult & { cwd: string; tempFile: string }> {
  const language = input.language ?? '';
  const code = input.code ?? '';
  if (!language || !code.trim()) throw new Error('language and code are required.');
  if (code.length > 100_000) throw new Error('Code is too long.');
  if ((input.stdin ?? '').length > 20_000) throw new Error('Input is too long.');

  const { cwd } = getTerminalCwd(input.cwdKey);
  const requestedDir = input.fileName?.trim()
    ? dirname(resolve(cwd, input.fileName.trim()))
    : cwd;
  const targetDir = isInside(cwd, requestedDir) && existsSync(requestedDir) ? requestedDir : cwd;

  if (language === 'java') {
    const runDir = resolve(targetDir, `.wip-run-${crypto.randomUUID()}`);
    if (!isInside(cwd, runDir)) throw new Error('Invalid temp path.');
    const mainClass = code.match(/\bpublic\s+class\s+([A-Za-z_$][\w$]*)/)?.[1]
      ?? code.match(/\bclass\s+([A-Za-z_$][\w$]*)/)?.[1]
      ?? 'Main';
    const tempFile = resolve(runDir, `${mainClass}.java`);
    const startedAt = Date.now();
    try {
      await mkdir(runDir, { recursive: true });
      await writeFile(tempFile, code, 'utf8');
      const compile = await runProcess('javac', ['-encoding', 'UTF-8', tempFile], { cwd: runDir, timeout: 15000, compiler: 'javac' });
      if (compile.exitCode !== 0) return { ...compile, durationMs: Date.now() - startedAt, cwd, tempFile };
      const result = await runProcess('java', [...javaUtf8Args, '-cp', runDir, mainClass], { cwd: runDir, stdin: input.stdin ?? '', timeout: 15000, compiler: 'javac + java' });
      return { ...result, durationMs: Date.now() - startedAt, cwd, tempFile };
    } finally {
      await rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const extension = getProjectCodeExtension(language, input.fileName);
  const base = input.fileName?.trim()
    ? basename(input.fileName.trim(), extname(input.fileName.trim()))
    : 'snippet';
  const tempFile = resolve(targetDir, `.wip-run-${base.replace(/[^a-zA-Z0-9_-]/g, '-')}-${crypto.randomUUID()}${extension}`);
  if (!isInside(cwd, tempFile)) throw new Error('Invalid temp file path.');

  const startedAt = Date.now();
  const runner = getProjectCodeRunner(language, tempFile, cwd);
  await mkdir(dirname(tempFile), { recursive: true });
  await writeFile(tempFile, code, 'utf8');

  try {
    const result = await runProcess(runner.file, runner.args, { cwd, stdin: input.stdin ?? '', timeout: 15000, compiler: runner.compiler });
    return { ...result, durationMs: Date.now() - startedAt, cwd, tempFile };
  } finally {
    await rm(tempFile, { force: true }).catch(() => {});
  }
}

app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Serve built frontend static assets (js, css, images, etc.)
if (hasFrontend) {
  app.use(express.static(frontendDist));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, nickname } = req.body as { email?: string; password?: string; nickname?: string };
    if (!email || !password || !nickname) throw new Error('Email, password, and nickname are required.');
    const user = await store.createUser(email, password, nickname);
    await setAuthCookie(res, user);
    res.status(201).json({ user });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new Error('Email and password are required.');
    const user = await store.verifyUser(email, password);
    await setAuthCookie(res, user);
    res.json({ user });
  } catch (error) {
    handleError(res, error, 401);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const refresh = req.cookies?.wip_refresh;
  if (refresh) {
    activeRefreshTokens.delete(refresh);
    await store.revokeRefreshToken(refresh);
  }
  res.clearCookie('wip_token');
  res.clearCookie('wip_refresh');
  res.status(204).send();
});

app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

app.get('/api/auth/session', async (req, res) => {
  try {
    const token = req.cookies?.wip_token;
    if (token) {
      const payload = jwt.verify(token, jwtSecret) as { email?: string; sid?: string };
      if (payload.email && payload.sid === serverSessionId) {
        const user = await store.getUserByEmail(payload.email);
        if (user) {
          res.json({ user });
          return;
        }
      }
    }
  } catch {
    // Fall through to refresh-token recovery.
  }

  const refresh = req.cookies?.wip_refresh;
  if (refresh && activeRefreshTokens.has(refresh)) {
    const userId = await store.validateRefreshToken(refresh);
    const user = userId ? await store.getUserById(userId) : null;
    if (user) {
      setAccessCookie(res, user);
      res.json({ user });
      return;
    }
  }

  res.json({ user: null });
});

app.put('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { nickname } = req.body as { nickname?: string };
    if (!nickname) throw new Error('Nickname is required.');
    const user = await store.updateNickname(req.user.email, nickname);
    res.json({ user });
  } catch (error) {
    handleError(res, error);
  }
});

// 리프레시 토큰으로 새 액세스 토큰 발급
app.post('/api/auth/refresh', async (req, res) => {
  const refresh = req.cookies?.wip_refresh;
  if (!refresh || !activeRefreshTokens.has(refresh)) { res.status(401).json({ error: 'Refresh token missing.' }); return; }
  const userId = await store.validateRefreshToken(refresh);
  if (!userId) { res.status(401).json({ error: 'Invalid or expired refresh token.' }); return; }
  const user = await store.getUserById(userId);
  if (!user) { res.status(401).json({ error: 'User not found.' }); return; }
  // 새 액세스 토큰만 갱신 (리프레시 토큰은 유지)
  setAccessCookie(res, user);
  res.json({ user });
});

app.post('/api/auth/find-password', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) { res.status(400).json({ error: 'Email is required.' }); return; }
    const token = await store.createResetToken(email);
    // 실제 서비스에서는 이메일로 전송 — 개발환경에서는 응답에 토큰 포함
    res.json({ message: '비밀번호 재설정 링크가 생성됐습니다.', resetToken: token });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body as { token?: string; newPassword?: string };
    if (!token || !newPassword) throw new Error('token and newPassword are required.');
    await store.applyResetToken(token, newPassword);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) throw new Error('Current password and new password are required.');
    await store.changePassword(req.user.email, currentPassword, newPassword);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/auth/deactivate', requireAuth, (_req, res) => {
  res.clearCookie('wip_token'); // 세션 종료 (데이터는 유지)
  res.status(204).send();
});

app.post('/api/auth/delete', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { password } = req.body as { password?: string };
    if (!password) throw new Error('Password is required.');
    await store.deleteUser(req.user.email, password);
    const refresh = req.cookies?.wip_refresh;
    if (refresh) await store.revokeRefreshToken(refresh);
    res.clearCookie('wip_token');
    res.clearCookie('wip_refresh');
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/users', requireAuth, async (req: AuthRequest, res) => {
  res.json({ users: await store.listUsers(req.user!.email) });
});

app.get('/api/workspace/members', requireAuth, async (req: AuthRequest, res) => {
  res.json({ members: await store.listWorkspaceMembers(req.user!.id) });
});

app.get('/api/dm/contacts', requireAuth, async (req: AuthRequest, res) => {
  res.json({ contacts: await store.listDmContacts(req.user!.id) });
});

app.get('/api/dm/conversations', requireAuth, async (req: AuthRequest, res) => {
  res.json({ conversations: await store.listDmConversations(req.user!.id) });
});

app.post('/api/dm/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { name, memberIds } = req.body as { name?: string; memberIds?: string[] };
    if (!Array.isArray(memberIds)) throw new Error('memberIds must be an array.');
    const conversation = await store.createDmConversation(req.user, name, memberIds);
    for (const memberId of conversation.memberIds) {
      io.to(`user:${memberId}`).emit('dm:conversations:update');
      io.to(`user:${memberId}`).emit('notification:update');
    }
    res.status(201).json({ conversation });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/dm/conversations/:conversationId/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const messages = await store.getDmConversationMessages(String(req.params.conversationId), req.user.id);
    res.json({ messages });
  } catch (error) {
    handleError(res, error, 404);
  }
});

app.post('/api/dm/conversations/:conversationId/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { text } = req.body as { text?: string };
    if (!text?.trim()) throw new Error('Text is required.');
    const conversationId = String(req.params.conversationId);
    const conversation = await store.getDmConversation(conversationId, req.user.id);
    if (!conversation) throw new Error('DM conversation not found.');
    const message = await store.createDmConversationMessage(conversationId, req.user.id, req.user.nickname, text.trim());
    const groupKey = `group:${conversationId}`;
    // 보낸 사람은 읽음 처리
    await store.markDmRead(req.user.id, groupKey);
    for (const memberId of conversation.memberIds) {
      io.to(`user:${memberId}`).emit('dm:new', message);
      if (memberId !== req.user.id) {
        io.to(`user:${memberId}`).emit('unread:dm', { conversationKey: groupKey });
        io.to(`user:${memberId}`).emit('notification:update');
      }
    }
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error, 404);
  }
});

app.post('/api/workspace/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) throw new Error('Email is required.');
    const member = await store.addWorkspaceMember(req.user!, email);
    io.to(`user:${req.user!.id}`).emit('dm:contacts:update');
    io.to(`user:${member.id}`).emit('dm:contacts:update');
    io.to(`user:${member.id}`).emit('notification:update');
    res.status(201).json({ member });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/dm/:userId/messages', requireAuth, (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: 'Not authenticated.' }); return; }
  store.getDmMessages(req.user.id, String(req.params.userId)).then((messages) => res.json({ messages })).catch((error) => handleError(res, error));
});

app.post('/api/dm/:userId/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { text } = req.body as { text?: string };
    if (!text?.trim()) throw new Error('Text is required.');
    const toId = String(req.params.userId);
    const message = await store.createDmMessage(req.user.id, req.user.nickname, toId, text.trim());
    // 보낸 사람은 읽음 처리
    await store.markDmRead(req.user.id, toId);
    io.to(`user:${toId}`).emit('dm:new', message);
    io.to(`user:${toId}`).emit('unread:dm', { conversationKey: req.user.id });
    io.to(`user:${toId}`).emit('notification:update');
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/channels', requireAuth, async (req: AuthRequest, res) => {
  res.json({ channels: await store.listChannels(req.user!.id) });
});

// ─── Read Receipts ───────────────────────────────────────────────────────────

app.get('/api/unread', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [channelIds, dmKeys] = await Promise.all([
      store.getUnreadChannelIds(req.user!.id),
      store.getUnreadDmKeys(req.user!.id),
    ]);
    res.json({ channelIds, dmKeys });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/channels/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    if (!(await store.canAccessChannel(channelId, req.user!.id))) {
      res.status(403).json({ error: 'Not a channel member.' });
      return;
    }
    await store.markChannelRead(req.user!.id, channelId);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/dm/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { conversationKey } = req.body as { conversationKey?: string };
    if (!conversationKey) {
      res.status(400).json({ error: 'conversationKey required.' });
      return;
    }
    await store.markDmRead(req.user!.id, conversationKey);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/search', requireAuth, async (req: AuthRequest, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const rawScope = typeof req.query.scope === 'string' ? req.query.scope : 'all';
    const scope = rawScope === 'messages' || rawScope === 'code' ? rawScope : 'all';
    res.json({ results: await store.search(req.user!.id, query, scope) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/settings', requireAuth, async (req: AuthRequest, res) => {
  res.json({ settings: await store.getSettings(req.user!.id) });
});

app.put('/api/settings', requireAuth, async (req: AuthRequest, res) => {
  try {
    res.json({ settings: await store.updateSettings(req.user!.id, req.body) });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
  res.json({ notifications: await store.getNotifications(req.user!) });
});

app.post('/api/notifications/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids)) throw new Error('ids must be an array.');
    await store.markNotificationsRead(req.user!.id, ids);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/channels', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { name, description, memberIds } = req.body as { name?: string; description?: string; memberIds?: string[] };
    if (!name) throw new Error('Channel name is required.');
    const channel = await store.createChannel(
      name.trim().toLowerCase().replace(/\s+/g, '-'),
      description ?? '',
      req.user!.id,
      Array.isArray(memberIds) ? memberIds : [],
    );
    for (const memberId of channel.memberIds.filter((id) => id !== req.user!.id)) {
      io.to(`user:${memberId}`).emit('channel:list:update');
    }
    res.status(201).json({ channel });
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/channels/:id/members', requireAuth, async (req, res) => {
  if (!(await store.canAccessChannel(String(req.params.id), (req as AuthRequest).user!.id))) {
    res.status(403).json({ error: 'Channel is not in your workspace.' });
    return;
  }
  res.json({ members: await store.getChannelMembers(String(req.params.id)) });
});

app.post('/api/channels/:id/members', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.body as { userId?: string };
    if (!userId) throw new Error('userId is required.');
    const member = await store.inviteChannelMember(String(req.params.id), req.user!.id, userId);
    io.to(`user:${member.id}`).emit('channel:list:update');
    io.to(`user:${member.id}`).emit('notification:update');
    res.status(201).json({ member });
  } catch (error) {
    handleError(res, error);
  }
});

app.put('/api/channels/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    if (!(await store.canAccessChannel(channelId, req.user!.id))) {
      res.status(403).json({ error: 'Channel is not accessible.' });
      return;
    }
    const { name, description } = req.body as { name?: string; description?: string };
    const channel = await store.updateChannel(channelId, req.user!.id, { name, description });
    const members = await store.getChannelMembers(channelId);
    for (const member of members) {
      io.to(`user:${member.id}`).emit('channel:list:update');
    }
    res.json({ channel });
  } catch (error) {
    handleError(res, error);
  }
});

app.delete('/api/channels/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    const members = await store.getChannelMembers(channelId);
    await store.deleteChannel(channelId, req.user!.id);
    for (const member of members) {
      io.to(`user:${member.id}`).emit('channel:list:update');
    }
    res.status(204).send();
  } catch (error) {
    handleError(res, error, 403);
  }
});

app.post('/api/channels/:id/leave', requireAuth, async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    await store.leaveChannel(channelId, req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.get('/api/channels/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const channelId = String(req.params.id);
    if (!(await store.canAccessChannel(channelId, req.user!.id))) {
      res.status(403).json({ error: 'Channel is not in your workspace.' });
      return;
    }
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const limit = rawLimit && Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : undefined;
    res.json({ messages: await store.listMessages(channelId, { before, limit }) });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const { channelId, content, codeBlocks, quoteRef, status, kind } = req.body;
    if (!channelId || !content) throw new Error('channelId and content are required.');
    const message = await store.createMessage({
      channelId,
      authorId: req.user.id,
      authorName: req.user.nickname,
      content,
      codeBlocks: Array.isArray(codeBlocks) ? codeBlocks : [],
      quoteRef,
      status: status === 'completed' ? 'completed' : 'in-progress',
      kind: kind === 'task' ? 'task' : 'chat',
    });
    io.to(`channel:${message.channelId}`).emit('message:new', message);
    const members = await store.getChannelMembers(message.channelId);
    // 보낸 사람은 읽음 처리, 나머지는 unread 알림
    await store.markChannelRead(req.user.id, message.channelId);
    for (const member of members) {
      if (member.id !== req.user.id) {
        io.to(`user:${member.id}`).emit('unread:channel', { channelId: message.channelId });
        io.to(`user:${member.id}`).emit('notification:update');
      }
    }
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

// ─── Threads ─────────────────────────────────────────────────────────────────
app.get('/api/messages/:id/thread', requireAuth, async (req: AuthRequest, res) => {
  const channelId = await store.getMessageChannelId(String(req.params.id));
  if (!channelId || !(await store.canAccessChannel(channelId, req.user!.id))) {
    res.status(403).json({ error: 'Thread is not accessible.' });
    return;
  }
  res.json({ messages: await store.listThreadMessages(String(req.params.id)) });
});

app.post('/api/messages/:id/thread', requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) throw new Error('Not authenticated.');
    const parentId = String(req.params.id);
    const { channelId, content, codeBlocks, status, kind } = req.body;
    if (!content || !channelId) throw new Error('channelId and content are required.');
    if (!(await store.canAccessChannel(channelId, req.user.id))) throw new Error('You are not a channel member.');
    const message = await store.createThreadMessage(parentId, {
      channelId,
      authorId: req.user.id,
      authorName: req.user.nickname,
      content,
      codeBlocks: Array.isArray(codeBlocks) ? codeBlocks : [],
      status: status === 'completed' ? 'completed' : 'in-progress',
      kind: kind === 'task' ? 'task' : 'chat',
    });
    io.to(`channel:${message.channelId}`).emit('thread:new', { parentId, message });
    const members = await store.getChannelMembers(message.channelId);
    for (const member of members) {
      if (member.id !== req.user.id) io.to(`user:${member.id}`).emit('notification:update');
    }
    res.status(201).json({ message });
  } catch (error) {
    handleError(res, error);
  }
});

app.put('/api/messages/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const messageId = String(req.params.id);
    const message = await store.updateMessage(messageId, req.body, req.user!.id);
    io.to(`channel:${message.channelId}`).emit('message:update', message);
    if (message.kind === 'task' && message.status === 'completed') {
      const members = await store.getChannelMembers(message.channelId);
      for (const member of members) {
        if (member.id !== req.user!.id) io.to(`user:${member.id}`).emit('notification:update');
      }
    }
    res.json({ message });
  } catch (error) {
    handleError(res, error, 404);
  }
});

// ─── Friends ────────────────────────────────────────────────────────────────
app.get('/api/friends', requireAuth, async (req: AuthRequest, res) => {
  res.json({ friends: await store.getFriends(req.user!.id) });
});

app.get('/api/friends/requests', requireAuth, async (req: AuthRequest, res) => {
  res.json({
    received: await store.getPendingReceivedRequests(req.user!.id),
    sent: await store.getPendingSentRequests(req.user!.id),
  });
});

app.post('/api/friends/request', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { toId } = req.body as { toId?: string };
    if (!toId) throw new Error('toId is required.');
    const request = await store.sendFriendRequest(req.user!.id, req.user!.nickname, toId);
    io.to(`user:${toId}`).emit('friend:requests:update');
    io.to(`user:${toId}`).emit('notification:update');
    res.status(201).json({ request });
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/friends/accept/:requestId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const requesterId = await store.acceptFriendRequest(String(req.params.requestId), req.user!.id);
    io.to(`user:${requesterId}`).emit('dm:contacts:update');
    io.to(`user:${req.user!.id}`).emit('dm:contacts:update');
    io.to(`user:${requesterId}`).emit('friend:list:update');
    io.to(`user:${req.user!.id}`).emit('friend:list:update');
    io.to(`user:${requesterId}`).emit('notification:update');
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/friends/decline/:requestId', requireAuth, async (req: AuthRequest, res) => {
  try {
    await store.declineFriendRequest(String(req.params.requestId), req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/friends/cancel/:requestId', requireAuth, async (req: AuthRequest, res) => {
  try {
    await store.cancelFriendRequest(String(req.params.requestId), req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.delete('/api/friends/:friendId', requireAuth, async (req: AuthRequest, res) => {
  try {
    await store.removeFriend(req.user!.id, String(req.params.friendId));
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

// ─── Snippets ────────────────────────────────────────────────────────────────
app.get('/api/snippets', requireAuth, async (req: AuthRequest, res) => {
  res.json({ snippets: await store.listSnippets(req.user!.id) });
});

app.post('/api/snippets', requireAuth, async (req: AuthRequest, res) => {
  try {
    const snippet = await store.createSnippet(req.user!.id, req.body);
    res.status(201).json({ snippet });
  } catch (error) {
    handleError(res, error);
  }
});

app.put('/api/snippets/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const snippet = await store.updateSnippet(String(req.params.id), req.user!.id, req.body);
    res.json({ snippet });
  } catch (error) {
    handleError(res, error, 404);
  }
});

app.delete('/api/snippets/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    await store.deleteSnippet(String(req.params.id), req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error, 404);
  }
});

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────
// requireAuth 없음 — code 자체가 1회용 비밀값이므로 별도 인증 불필요
app.post('/api/github/token', async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: 'code is required.' }); return; }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'GitHub OAuth가 설정되지 않았습니다. 서버의 GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET 환경변수를 확인하세요.' });
    return;
  }

  try {
    const ghRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await ghRes.json() as { access_token?: string; error?: string; error_description?: string };
    if (data.error || !data.access_token) {
      res.status(400).json({ error: data.error_description ?? data.error ?? 'GitHub 인증에 실패했습니다.' });
      return;
    }
    res.json({ access_token: data.access_token });
  } catch (error) {
    handleError(res, error);
  }
});

// ─── Runner ──────────────────────────────────────────────────────────────────
app.get('/api/github/connection', requireAuth, async (req: AuthRequest, res) => {
  try {
    res.json({ connection: await store.getGitHubConnection(req.user!.id) });
  } catch (error) {
    handleError(res, error);
  }
});

app.put('/api/github/connection', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { token, userLogin, repoFullName, repoInfo, notifications, seenIds } = req.body ?? {};
    if (typeof token !== 'string' || !token.trim()) {
      res.status(400).json({ error: 'token is required.' });
      return;
    }
    const connection = await store.upsertGitHubConnection(req.user!.id, {
      token,
      userLogin: typeof userLogin === 'string' ? userLogin : null,
      repoFullName: typeof repoFullName === 'string' ? repoFullName : '',
      repoInfo: repoInfo ?? null,
      notifications: Array.isArray(notifications) ? notifications : [],
      seenIds: Array.isArray(seenIds) ? seenIds.filter((id) => typeof id === 'string') : [],
    });
    res.json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

app.delete('/api/github/connection', requireAuth, async (req: AuthRequest, res) => {
  try {
    await store.deleteGitHubConnection(req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/runner/execute', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { language, code, stdin } = req.body as { language?: string; code?: string; stdin?: string };
    const result = await executeStandaloneCode(language ?? '', code ?? '', stdin ?? '');
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/runner/project', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await executeProjectCode(req.body as { language?: string; code?: string; fileName?: string; cwdKey?: string; stdin?: string });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

app.post('/api/terminal/execute', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { command, cwdKey } = req.body as { command?: string; cwdKey?: string };
    const result = await runTerminalCommand(command ?? '', cwdKey);
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

// SPA fallback: serve index.html for all non-API GET routes
if (hasFrontend) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(join(frontendDist, 'index.html'));
    } else {
      next();
    }
  });
} else {
  // Dev hint: frontend not built yet, user should use Vite dev server
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.status(404).send(
        '<!doctype html><html><body style="font-family:monospace;padding:2rem">' +
        '<h2>⚠️ 프론트엔드 빌드 없음</h2>' +
        '<p>개발 시: <code>cd ../WIP-Frontend && npm run dev</code> 를 실행한 뒤 <a href="http://localhost:5173">localhost:5173</a> 으로 접속하세요.</p>' +
        '<p>또는 프론트엔드를 빌드한 뒤 이 서버를 재시작하세요: <code>cd ../WIP-Frontend && npm run build</code></p>' +
        '</body></html>',
      );
    } else {
      next();
    }
  });
}

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`WIP backend could not start: port ${port} is already in use.`);
    console.error(`Stop the existing backend process or set a different PORT in .env.`);
    process.exit(1);
  }
  console.error('WIP backend failed to start:', error);
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`WIP backend listening on http://localhost:${port}`);
  if (hasFrontend) {
    console.log(`  → Frontend served from ${frontendDist}`);
  } else {
    console.log(`  → Frontend not built. Run dev server: cd ../WIP-Frontend && npm run dev`);
  }
});
