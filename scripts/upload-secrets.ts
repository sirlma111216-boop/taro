/*
 * Cloudflare 비밀값 한 번에 올리기
 *   npm run secrets:upload
 *
 * - .dev.vars 의 OPERATOR_USERNAME, OPERATOR_PASSWORD_HASH, GEMINI_API_KEY 를 읽고
 *   SESSION_SECRET 은 운영용으로 새로 만들어, `wrangler secret bulk` 에 표준 입력으로 넘깁니다.
 * - 터미널에 붙여 넣는 과정이 없어 값이 잘리거나 바뀌지 않습니다.
 * - 화면에는 이름과 글자 수만 표시하고 값은 출력하지 않습니다.
 * - 학교망처럼 HTTPS를 검사하는 네트워크를 위해 Windows 인증서 저장소를 사용합니다(NODE_USE_SYSTEM_CA=1).
 * 먼저 `npx wrangler login` 이 되어 있어야 합니다.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parsePasswordHash, toBase64Url } from '../src/worker/crypto.ts';

const ROOT = resolve(import.meta.dirname, '..');
const file = join(ROOT, '.dev.vars');
if (!existsSync(file)) {
  console.error('.dev.vars 가 없습니다. 먼저 npm run setup:local 로 만들고 GEMINI_API_KEY 를 넣어 주세요.');
  process.exit(1);
}

const vars = new Map<string, string>();
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) vars.set(m[1]!, m[2]!.replace(/^"(.*)"$/, '$1'));
}

const problems: string[] = [];
const username = vars.get('OPERATOR_USERNAME') ?? '';
const hash = vars.get('OPERATOR_PASSWORD_HASH') ?? '';
const apiKey = vars.get('GEMINI_API_KEY') ?? '';
if (!username) problems.push('OPERATOR_USERNAME 이 비어 있습니다.');
try {
  parsePasswordHash(hash);
} catch (error) {
  problems.push(`OPERATOR_PASSWORD_HASH 형식 오류: ${(error as Error).message}`);
}
if (apiKey.length < 20 || /\s/.test(apiKey)) problems.push('GEMINI_API_KEY 가 비었거나 형식이 이상합니다.');
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const secretBytes = new Uint8Array(48);
crypto.getRandomValues(secretBytes);
const secrets: Record<string, string> = {
  OPERATOR_USERNAME: username,
  OPERATOR_PASSWORD_HASH: hash,
  GEMINI_API_KEY: apiKey,
  SESSION_SECRET: toBase64Url(secretBytes),
};

console.log('Cloudflare Worker "starlight-tarot" 에 올릴 비밀값:');
for (const [k, v] of Object.entries(secrets)) console.log(`  - ${k} (${v.length}자)`);

const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const child = spawn(process.execPath, [wrangler, 'secret', 'bulk'], {
  cwd: ROOT,
  env: { ...process.env, NODE_USE_SYSTEM_CA: '1' },
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify(secrets));
child.on('exit', (code) => {
  if (code === 0) console.log('✓ 완료. 운영용 세션 비밀값이 새로 바뀌었으므로 부스 화면에서 한 번 다시 로그인하면 됩니다.');
  else console.error(`✗ 업로드 실패 (종료 코드 ${code}). npx wrangler login 상태를 확인해 주세요.`);
  process.exit(code ?? 1);
});
