import { existsSync, readFileSync } from 'node:fs';

/** 세션 서명용 비밀값: 암호학적 난수 32바이트를 64자리 16진수로 */
export function newSessionSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 서버(auth.ts)의 32자 이상 규칙 + 붙여넣기 사고로 섞인 공백·제어 문자가 없는지 */
export function isValidSessionSecret(value: string | undefined): value is string {
  return typeof value === 'string' && value.length >= 32 && !/[\s\u0000-\u001f\u007f]/.test(value);
}

export function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/** .dev.vars(KEY=VALUE) 읽기. 값은 호출한 쪽에서 출력하지 않습니다. */
export function readDevVars(file: string): Map<string, string> {
  const vars = new Map<string, string>();
  if (!existsSync(file)) return vars;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) vars.set(m[1]!, m[2]!.replace(/^"(.*)"$/, '$1'));
  }
  return vars;
}
