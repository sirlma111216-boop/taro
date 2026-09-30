/*
 * 비밀값 유출 점검
 *   npm run check:secrets
 *
 * 1) Git에 올라갈 파일(추적 중 + 새로 추가될 파일)과 2) 브라우저로 배포되는 빌드 결과(dist/client)를 훑어
 *    - .dev.vars 에 적힌 실제 비밀값(API 키, 비밀번호 해시, 세션 비밀값)이 그대로 들어 있는지
 *    - Google API 키·PBKDF2 해시·개인 키 같은 모양의 문자열이 있는지
 *    - .dev.vars / .env 파일 자체가 포함되는지
 *   를 확인합니다. 비밀값은 메모리에서만 비교하고 화면에 출력하지 않습니다.
 *
 * 추가로 확인할 값(예: 운영자 평문 비밀번호)은 환경변수로만 넘기세요. 이 파일에 적지 마세요.
 *   PowerShell:  $env:STARLIGHT_EXTRA_SECRETS = "값1,값2"; npm run check:secrets
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const TEXT_EXT = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.html', '.css', '.txt', '.toml', '.yml', '.yaml',
  '.svg', '.map', '.example', '.gitignore', '', '.vars', '.env', '.sh', '.ps1',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', 'coverage', 'test-results']);

interface Finding {
  file: string;
  reason: string;
}

function readDevVars(): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const name of ['.dev.vars', join('tests', 'e2e', '.tmp', '.dev.vars')]) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const [, key, value] = m as unknown as [string, string, string];
      if (/KEY|SECRET|HASH|PASSWORD|TOKEN/.test(key) && value.length >= 8) secrets.set(`${name}:${key}`, value);
    }
  }
  for (const [i, value] of (process.env.STARLIGHT_EXTRA_SECRETS ?? '').split(',').entries()) {
    if (value.trim().length >= 6) secrets.set(`STARLIGHT_EXTRA_SECRETS[${i}]`, value.trim());
  }
  return secrets;
}

const PATTERNS: [RegExp, string][] = [
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API 키 형식(AIza…)'],
  [/\bAQ\.[0-9A-Za-z_-]{30,}/, 'Google API 키 형식(AQ.…)'],
  [/pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{40,}/, '비밀번호 해시 값'],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, '개인 키'],
  [/\bsl_session=v1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, '세션 쿠키 값'],
];

function gitFiles(): string[] | null {
  if (!existsSync(join(ROOT, '.git'))) return null;
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  return [...new Set([...run(['ls-files', '-z']), ...run(['ls-files', '-z', '--others', '--exclude-standard'])])];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

function walkAll(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

function scan(files: string[], secrets: Map<string, string>, label: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const base = file.split(/[\\/]/).pop() ?? file;
    if (/^\.dev\.vars(\..+)?$/.test(base) && !base.endsWith('.example')) findings.push({ file, reason: `${label}에 .dev.vars 파일이 포함됨` });
    if (/^\.env(\..+)?$/.test(base) && !base.endsWith('.example')) findings.push({ file, reason: `${label}에 .env 파일이 포함됨` });
    const ext = extname(base).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    const full = join(ROOT, file);
    if (!existsSync(full) || statSync(full).size > 20 * 1024 * 1024) continue;
    const text = readFileSync(full, 'utf8');
    for (const [name, value] of secrets) {
      if (text.includes(value)) findings.push({ file, reason: `실제 비밀값(${name.split(':').pop()})이 들어 있음` });
    }
    for (const [pattern, reason] of PATTERNS) {
      if (pattern.test(text)) findings.push({ file, reason });
    }
  }
  return findings;
}

const secrets = readDevVars();
const tracked = gitFiles();
const repoFiles = tracked ?? walk(ROOT);
const clientFiles = walkAll(join(ROOT, 'dist', 'client'));

const findings = [
  ...scan(repoFiles, secrets, tracked ? 'Git에 올라갈 파일' : '프로젝트 파일'),
  ...scan(clientFiles, secrets, '배포되는 클라이언트 빌드'),
].filter((f) => !(f.file.split(sep).join('/').startsWith('tests/e2e/.tmp/')));

console.log(`점검 대상: ${tracked ? 'Git에 올라갈' : '프로젝트'} 파일 ${repoFiles.length}개, 클라이언트 빌드 파일 ${clientFiles.length}개`);
console.log(`비교한 실제 비밀값: ${secrets.size}개 (값은 출력하지 않음)`);
if (!clientFiles.length) console.log('⚠ dist/client 가 없습니다. npm run build 후 다시 실행하면 배포 파일도 점검합니다.');

if (findings.length) {
  console.error(`✗ 비밀값 의심 ${findings.length}건`);
  for (const f of findings) console.error(`  - ${f.file}: ${f.reason}`);
  process.exit(1);
}
console.log('✓ 비밀값이 발견되지 않았습니다.');
