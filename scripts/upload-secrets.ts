/*
 * Cloudflare 비밀값(Secret 바인딩) 올리기
 *   npm run secrets:upload                      네 가지 모두
 *   npm run secrets:upload -- SESSION_SECRET    지정한 것만 (여러 개는 공백으로 구분)
 *
 * - OPERATOR_USERNAME, OPERATOR_PASSWORD_HASH, GEMINI_API_KEY 는 .dev.vars 의 값을 그대로 올립니다.
 *   (로컬 .dev.vars 는 배포 서버로 자동 전달되지 않습니다.)
 * - SESSION_SECRET 은 운영용으로 새로 만듭니다: 암호학적 난수 32바이트 → 64자리 16진수.
 * - 값은 `wrangler secret bulk` 의 표준 입력으로만 넘기고, 화면에는 이름과 글자 수만 표시합니다.
 *   터미널에 붙여 넣지 않으므로 값이 잘리거나 제어 문자가 섞이지 않습니다.
 * - 학교망처럼 HTTPS를 검사하는 네트워크를 위해 Windows 인증서 저장소를 사용합니다(NODE_USE_SYSTEM_CA=1).
 * 먼저 `npx wrangler login` 이 되어 있어야 합니다.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePasswordHash } from '../src/worker/crypto.ts';
import { hasControlChars, isValidSessionSecret, newSessionSecret, readDevVars } from './lib/secrets.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FILE = join(ROOT, '.dev.vars');
const ALL = ['OPERATOR_USERNAME', 'OPERATOR_PASSWORD_HASH', 'SESSION_SECRET', 'GEMINI_API_KEY'] as const;
type Name = (typeof ALL)[number];

const requested = process.argv.slice(2).map((s) => s.trim().toUpperCase()).filter(Boolean);
const unknown = requested.filter((n) => !(ALL as readonly string[]).includes(n));
if (unknown.length) {
  console.error(`알 수 없는 이름: ${unknown.join(', ')} (사용 가능: ${ALL.join(', ')})`);
  process.exit(1);
}
const names: Name[] = requested.length ? (requested as Name[]) : [...ALL];

if (!existsSync(FILE) && names.some((n) => n !== 'SESSION_SECRET')) {
  console.error('.dev.vars 가 없습니다. 먼저 npm run setup:local 로 만들고 GEMINI_API_KEY 를 넣어 주세요.');
  process.exit(1);
}
const vars = readDevVars(FILE);

const secrets: Partial<Record<Name, string>> = {};
const problems: string[] = [];
for (const name of names) {
  if (name === 'SESSION_SECRET') {
    secrets.SESSION_SECRET = newSessionSecret();
    continue;
  }
  const value = vars.get(name) ?? '';
  if (!value) problems.push(`${name} 이(가) .dev.vars 에 없습니다.`);
  else if (hasControlChars(value) || /\s/.test(value)) problems.push(`${name} 에 공백이나 제어 문자가 섞여 있습니다.`);
  secrets[name] = value;
}
if (secrets.OPERATOR_PASSWORD_HASH) {
  try {
    parsePasswordHash(secrets.OPERATOR_PASSWORD_HASH);
  } catch (error) {
    problems.push(`OPERATOR_PASSWORD_HASH 형식 오류: ${(error as Error).message}`);
  }
}
if (secrets.GEMINI_API_KEY !== undefined && secrets.GEMINI_API_KEY.length < 20) problems.push('GEMINI_API_KEY 가 너무 짧습니다.');
if (secrets.SESSION_SECRET !== undefined && !isValidSessionSecret(secrets.SESSION_SECRET)) problems.push('SESSION_SECRET 생성 오류');
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

console.log('Cloudflare Worker "starlight-tarot" 에 올릴 비밀값(값은 표시하지 않음):');
for (const [k, v] of Object.entries(secrets)) console.log(`  - ${k} (${v.length}자)`);

const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const child = spawn(process.execPath, [wrangler, 'secret', 'bulk'], {
  cwd: ROOT,
  env: { ...process.env, NODE_USE_SYSTEM_CA: '1' },
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify(secrets));
child.on('exit', (code) => {
  if (code === 0) {
    console.log('✓ 완료. 다시 배포하지 않아도 바로 적용됩니다.');
    if (secrets.SESSION_SECRET) console.log('  세션 비밀값이 바뀌었으므로, 이미 로그인한 부스 화면은 한 번 다시 로그인해야 합니다.');
  } else {
    console.error(`✗ 업로드 실패 (종료 코드 ${code}). npx wrangler login 상태를 확인해 주세요.`);
  }
  process.exit(code ?? 1);
});
