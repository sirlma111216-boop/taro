import { constantTimeEqual, hmacSign, hmacVerify, sha256, toBase64Url, fromBase64Url, verifyPassword } from './crypto.ts';
import { DEFAULT_SESSION_TTL_HOURS, numberVar, type Env } from './env.ts';

export const SESSION_COOKIE = 'sl_session';
const TOKEN_VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;

export interface Session {
  sid: string;
  iat: number;
  exp: number;
}

export class AuthConfigError extends Error {}

export function authConfigProblem(env: Env): string | null {
  if (!env.OPERATOR_USERNAME) return 'OPERATOR_USERNAME이 설정되지 않았습니다.';
  if (!env.OPERATOR_PASSWORD_HASH) return 'OPERATOR_PASSWORD_HASH가 설정되지 않았습니다.';
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SECRET_LENGTH) {
    return `SESSION_SECRET은 ${MIN_SECRET_LENGTH}자 이상이어야 합니다.`;
  }
  return null;
}

export function sessionTtlSeconds(env: Env): number {
  return Math.round(numberVar(env.SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS, 1, 24) * 3600);
}

/** 아이디·비밀번호 확인. 아이디가 틀려도 같은 시간만큼 해시 계산을 합니다. */
export async function checkCredentials(env: Env, username: string, password: string): Promise<boolean> {
  const problem = authConfigProblem(env);
  if (problem) throw new AuthConfigError(problem);
  const [given, expected] = await Promise.all([sha256(username), sha256(env.OPERATOR_USERNAME ?? '')]);
  const usernameOk = constantTimeEqual(given, expected);
  const passwordOk = await verifyPassword(password, env.OPERATOR_PASSWORD_HASH ?? '');
  return usernameOk && passwordOk;
}

export async function createSessionToken(env: Env, now = Date.now()): Promise<{ token: string; session: Session }> {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new AuthConfigError('SESSION_SECRET 설정 오류');
  const sidBytes = new Uint8Array(16);
  crypto.getRandomValues(sidBytes);
  const iat = Math.floor(now / 1000);
  const session: Session = { sid: toBase64Url(sidBytes), iat, exp: iat + sessionTtlSeconds(env) };
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signed = `${TOKEN_VERSION}.${payload}`;
  const signature = await hmacSign(secret, signed);
  return { token: `${signed}.${signature}`, session };
}

export async function verifySessionToken(env: Env, token: string, now = Date.now()): Promise<Session | null> {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [version, payload, signature] = parts as [string, string, string];
  if (!(await hmacVerify(secret, `${version}.${payload}`, signature))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Partial<Session>;
    if (typeof data.sid !== 'string' || typeof data.iat !== 'number' || typeof data.exp !== 'number') return null;
    if (data.exp * 1000 <= now) return null;
    if (data.iat * 1000 > now + 60_000) return null;
    return { sid: data.sid, iat: data.iat, exp: data.exp };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=');
  }
  return null;
}

export async function getSession(env: Env, request: Request): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(env, token);
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
