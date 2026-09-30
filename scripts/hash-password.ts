/*
 * 운영자 비밀번호 해시 만들기
 *   npm run hash-password
 * 출력된 pbkdf2-sha256$... 문자열을 OPERATOR_PASSWORD_HASH 비밀값으로 등록하세요.
 * 평문 비밀번호는 어디에도 저장되지 않습니다.
 */
import { hashPassword } from '../src/worker/crypto.ts';
import { ask } from './lib/prompt.ts';

const password = process.env.OPERATOR_PASSWORD ?? (await ask('운영자 비밀번호: ', true));
if (password.length < 8) {
  console.error('비밀번호는 8자 이상으로 정해 주세요.');
  process.exit(1);
}
if (!process.env.OPERATOR_PASSWORD) {
  const again = await ask('한 번 더 입력: ', true);
  if (again !== password) {
    console.error('두 입력이 다릅니다.');
    process.exit(1);
  }
}
console.log(await hashPassword(password));
