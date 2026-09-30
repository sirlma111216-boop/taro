/*
 * 로컬 개발용 비밀값(.dev.vars) 만들기
 *   npm run setup:local
 * - 운영자 아이디와 비밀번호를 물어보고, 비밀번호는 PBKDF2 해시로만 저장합니다.
 * - SESSION_SECRET은 이미 유효한 값(32자 이상, 공백·제어 문자 없음)이 있으면 그대로 두고,
 *   없거나 잘못됐을 때만 암호학적 난수 32바이트(64자리 16진수)로 새로 만듭니다.
 * - 이미 .dev.vars에 있는 GEMINI_API_KEY, AI_MODE 등 다른 값은 그대로 둡니다.
 * - .dev.vars는 .gitignore에 들어 있어 GitHub에 올라가지 않습니다. 이 파일은 배포 서버로 전달되지 않으므로
 *   Cloudflare에는 따로 `npm run secrets:upload` 로 올려야 합니다.
 *
 * 자동화용: OPERATOR_USERNAME, OPERATOR_PASSWORD 환경변수가 있으면 묻지 않습니다.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashPassword } from '../src/worker/crypto.ts';
import { ask } from './lib/prompt.ts';
import { isValidSessionSecret, newSessionSecret, readDevVars } from './lib/secrets.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FILE = join(ROOT, '.dev.vars');

const existing = readDevVars(FILE);

const username = (process.env.OPERATOR_USERNAME ?? (await ask('운영자 아이디: '))).trim();
if (!username) {
  console.error('아이디를 입력해 주세요.');
  process.exit(1);
}
const password = process.env.OPERATOR_PASSWORD ?? (await ask('운영자 비밀번호: ', true));
if (password.length < 8) {
  console.error('비밀번호는 8자 이상이어야 합니다.');
  process.exit(1);
}

existing.set('OPERATOR_USERNAME', username);
existing.set('OPERATOR_PASSWORD_HASH', await hashPassword(password));
const keptSecret = isValidSessionSecret(existing.get('SESSION_SECRET'));
if (!keptSecret) existing.set('SESSION_SECRET', newSessionSecret());
if (!existing.has('GEMINI_API_KEY')) existing.set('GEMINI_API_KEY', '');

const lines = [
  '# 로컬 개발용 비밀값 — 절대 커밋하지 마세요 (.gitignore에 포함)',
  '# npm run setup:local 로 다시 만들 수 있습니다.',
  ...[...existing].map(([k, v]) => `${k}=${v}`),
  '',
];
writeFileSync(FILE, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
console.log(`✓ ${FILE} 를 저장했습니다. (비밀번호는 해시로만 저장됨)`);
console.log(keptSecret ? '  SESSION_SECRET: 기존의 유효한 값을 그대로 사용' : '  SESSION_SECRET: 새로 생성(64자리 16진수)');
if (!existing.get('GEMINI_API_KEY')) {
  console.log('  GEMINI_API_KEY가 비어 있습니다. 키가 있으면 .dev.vars에 적거나, 화면 흐름만 볼 때는 AI_MODE=mock 을 추가하세요.');
}
