import { describe, expect, it } from 'vitest';
import { authConfigProblem } from '../../src/worker/auth.ts';
import { hasControlChars, isValidSessionSecret, newSessionSecret } from '../../scripts/lib/secrets.ts';

describe('세션 비밀값 생성·검증', () => {
  it('32바이트 난수를 64자리 16진수로 만들고, 매번 다르다', () => {
    const a = newSessionSecret();
    const b = newSessionSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(isValidSessionSecret(a)).toBe(true);
  });

  it('터미널 붙여넣기 사고로 생긴 값(제어 문자 한 글자)과 짧은 값은 거부한다', () => {
    expect(isValidSessionSecret('\u0016')).toBe(false);
    expect(isValidSessionSecret('short')).toBe(false);
    expect(isValidSessionSecret('a'.repeat(31))).toBe(false);
    expect(isValidSessionSecret(`${'a'.repeat(40)} `)).toBe(false);
    expect(isValidSessionSecret(undefined)).toBe(false);
    expect(hasControlChars('\u0016')).toBe(true);
  });

  it('서버는 32자 미만 SESSION_SECRET을 설정 오류로 보고, 생성한 값은 통과시킨다', () => {
    const base = { OPERATOR_USERNAME: 'op', OPERATOR_PASSWORD_HASH: 'x' };
    expect(authConfigProblem({ ...base, SESSION_SECRET: '\u0016' })).toContain('32자 이상');
    expect(authConfigProblem({ ...base, SESSION_SECRET: newSessionSecret() })).toBeNull();
  });
});
