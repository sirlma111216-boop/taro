/*
 * E2E 테스트 준비
 * - 테스트 전용 wrangler 설정과 .dev.vars를 tests/e2e/.tmp 에 만듭니다(실제 운영자 계정은 쓰지 않음).
 * - AI_MODE=mock 으로 Vite 개발 서버를 별도 포트에서 띄웁니다.
 * - 설치된 Microsoft Edge 또는 Chrome을 playwright-core로 제어합니다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { createSessionToken } from '../../src/worker/auth.ts';
import { hashPassword, toBase64Url } from '../../src/worker/crypto.ts';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const TMP = join(ROOT, 'tests', 'e2e', '.tmp');
export const OUT = join(ROOT, 'tests', 'e2e', 'output');
export const PORT = 5199;
export const BASE = `http://localhost:${PORT}`;

export interface TestEnv {
  username: string;
  password: string;
  sessionSecret: string;
}

export async function prepareConfig(): Promise<TestEnv> {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const username = 'e2e-operator';
  const pw = new Uint8Array(12);
  crypto.getRandomValues(pw);
  const password = `E2e-${toBase64Url(pw)}`;
  const secretBytes = new Uint8Array(48);
  crypto.getRandomValues(secretBytes);
  const sessionSecret = toBase64Url(secretBytes);
  const main = relative(TMP, join(ROOT, 'src', 'worker', 'index.ts')).replace(/\\/g, '/');
  const config = {
    name: 'starlight-tarot',
    main,
    compatibility_date: '2026-09-29',
    assets: { not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
    vars: { GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_THINKING_LEVEL: 'low', GEMINI_TIMEOUT_MS: '35000', SESSION_TTL_HOURS: '10', AI_MODE: 'mock', LOGIN_LIMIT_PER_MINUTE: '60' },
    durable_objects: { bindings: [{ name: 'DAILY_CODE', class_name: 'DailyCodeStore' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['DailyCodeStore'] }],
    ratelimits: [
      { name: 'LOGIN_LIMITER', namespace_id: '41001', simple: { limit: 30, period: 60 } },
      { name: 'READING_LIMITER', namespace_id: '41002', simple: { limit: 60, period: 60 } },
    ],
  };
  writeFileSync(join(TMP, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(TMP, '.dev.vars'),
    [`OPERATOR_USERNAME=${username}`, `OPERATOR_PASSWORD_HASH=${await hashPassword(password)}`, `SESSION_SECRET=${sessionSecret}`, 'GEMINI_API_KEY=', 'AI_MODE=mock', ''].join('\n'),
  );
  return { username, password, sessionSecret };
}

/** 만료된 세션 쿠키 값(테스트 비밀값으로 서명) */
export async function expiredToken(env: TestEnv): Promise<string> {
  const { token } = await createSessionToken({ SESSION_SECRET: env.sessionSecret, SESSION_TTL_HOURS: '1' }, Date.now() - 3 * 3600_000);
  return token;
}

export async function startServer(): Promise<ChildProcess> {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'dev', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, STARLIGHT_WRANGLER_CONFIG: join(TMP, 'wrangler.jsonc'), BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (d) => (log += String(d)));
  child.stderr?.on('data', (d) => (log += String(d)));
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(`${BASE}/api/session`);
      if (res.ok) return child;
    } catch {
      /* 아직 준비 중 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`개발 서버가 시작되지 않았습니다.\n${log}`);
}

export function browserPath(): string | undefined {
  const candidates = [
    process.env.E2E_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && existsSync(p));
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = browserPath();
  if (!executablePath) throw new Error('Edge 또는 Chrome을 찾지 못했습니다. E2E_BROWSER 환경변수로 경로를 지정하세요.');
  return chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--lang=ko-KR'] });
}

// ---------------------------------------------------------------- 간단한 테스트 러너

export interface Result {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export const results: Result[] = [];

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  // E2E_ONLY="화면 배치" 처럼 이름 일부로 골라 실행할 수 있습니다.
  const only = process.env.E2E_ONLY;
  if (only && !name.includes(only)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, ms: Date.now() - started, error: message });
    console.log(`  ✗ ${name}\n    ${message.split('\n').slice(0, 4).join('\n    ')}`);
  }
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function expectEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n      실제: ${a}\n      기대: ${e}`);
}
