import { describe, expect, it } from 'vitest';
import { createSessionToken, readCookie, verifySessionToken } from '../../src/worker/auth.ts';
import { constantTimeEqual, hashPassword, parsePasswordHash, PasswordHashFormatError, verifyPassword } from '../../src/worker/crypto.ts';
import type { Env } from '../../src/worker/env.ts';

const SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';

describe('비밀번호 해시', () => {
  it('해시는 평문을 포함하지 않고, 맞는 비밀번호만 통과한다', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(hash).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('같은 비밀번호라도 솔트가 달라 해시가 매번 다르다', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });

  it('형식이 잘못된 해시는 설정 오류로 알린다', () => {
    expect(() => parsePasswordHash('plain-password')).toThrow(PasswordHashFormatError);
    expect(() => parsePasswordHash('pbkdf2-sha256$999999$AAAA$BBBB')).toThrow(PasswordHashFormatError);
  });

  it('상수 시간 비교', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
  });
});

describe('세션 토큰', () => {
  const env: Env = { SESSION_SECRET: SECRET, SESSION_TTL_HOURS: '2' };

  it('서명한 토큰은 만료 전까지 유효하다', async () => {
    const now = Date.UTC(2026, 9, 1, 9, 0, 0);
    const { token, session } = await createSessionToken(env, now);
    expect(session.exp - session.iat).toBe(2 * 3600);
    expect(await verifySessionToken(env, token, now + 60_000)).toMatchObject({ sid: session.sid });
    expect(await verifySessionToken(env, token, now + 2 * 3600_000 + 1)).toBeNull();
  });

  it('변조되거나 다른 비밀값으로 서명된 토큰은 거부한다', async () => {
    const { token } = await createSessionToken(env);
    const [v, payload, sig] = token.split('.') as [string, string, string];
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number };
    forged.exp += 999_999;
    const forgedPayload = Buffer.from(JSON.stringify(forged)).toString('base64url');
    expect(await verifySessionToken(env, `${v}.${forgedPayload}.${sig}`)).toBeNull();
    expect(await verifySessionToken({ SESSION_SECRET: SECRET + 'x' }, token)).toBeNull();
    expect(await verifySessionToken(env, 'garbage')).toBeNull();
    expect(await verifySessionToken(env, `${v}.${payload}.`)).toBeNull();
  });

  it('SESSION_SECRET이 짧으면 토큰을 만들지 않는다', async () => {
    await expect(createSessionToken({ SESSION_SECRET: 'short' })).rejects.toThrow();
    expect(await verifySessionToken({ SESSION_SECRET: 'short' }, 'v1.a.b')).toBeNull();
  });

  it('쿠키 파싱', () => {
    const req = new Request('https://x.test/', { headers: { Cookie: 'a=1; sl_session=v1.abc.def; b=2' } });
    expect(readCookie(req, 'sl_session')).toBe('v1.abc.def');
    expect(readCookie(req, 'none')).toBeNull();
  });
});
