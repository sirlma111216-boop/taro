/*
 * Web Crypto 기반 비밀번호 해시·세션 서명 도구.
 * Cloudflare Workers와 Node.js(테스트·스크립트) 양쪽에서 같은 코드로 동작합니다.
 */

const encoder = new TextEncoder();

/** Workers의 PBKDF2 반복 횟수 상한이 100,000회라서 이 값을 씁니다. */
export const PBKDF2_ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2-sha256';

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('base64url 형식이 아닙니다.');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 길이에 상관없이 끝까지 비교하는 상수 시간 비교 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** 저장용 해시 문자열 생성: pbkdf2-sha256$반복횟수$솔트$해시 */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iterations);
  return `${HASH_PREFIX}$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export class PasswordHashFormatError extends Error {}

export function parsePasswordHash(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } {
  const parts = stored.trim().split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) {
    throw new PasswordHashFormatError('OPERATOR_PASSWORD_HASH 형식이 올바르지 않습니다.');
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) {
    throw new PasswordHashFormatError('PBKDF2 반복 횟수는 10,000~100,000 사이여야 합니다.');
  }
  const salt = fromBase64Url(parts[2] ?? '');
  const hash = fromBase64Url(parts[3] ?? '');
  if (salt.length < 16 || hash.length !== 32) {
    throw new PasswordHashFormatError('솔트 또는 해시 길이가 올바르지 않습니다.');
  }
  return { iterations, salt, hash };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { iterations, salt, hash } = parsePasswordHash(stored);
  const candidate = await pbkdf2(password, salt, iterations);
  return constantTimeEqual(candidate, hash);
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

export async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = fromBase64Url(signature);
  } catch {
    return false;
  }
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, sig as BufferSource, encoder.encode(data));
}
