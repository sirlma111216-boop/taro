/** Cloudflare Rate Limiting 바인딩의 최소 인터페이스 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  // --- 비밀값 (wrangler secret put / .dev.vars) ---
  OPERATOR_USERNAME?: string;
  OPERATOR_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  GEMINI_API_KEY?: string;

  // --- 일반 설정값 (wrangler.jsonc vars) ---
  GEMINI_MODEL?: string;
  GEMINI_THINKING_LEVEL?: string;
  GEMINI_TIMEOUT_MS?: string;
  SESSION_TTL_HOURS?: string;
  /** 인스턴스 메모리 기준 로그인 시도 제한(1분, 3~60, 기본 5) */
  LOGIN_LIMIT_PER_MINUTE?: string;
  /** 'gemini'(기본) 또는 'mock'(로컬 테스트 전용) */
  AI_MODE?: string;

  // --- 바인딩 ---
  LOGIN_LIMITER?: RateLimiter;
  READING_LIMITER?: RateLimiter;
}

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_THINKING_LEVEL = 'low';
export const DEFAULT_TIMEOUT_MS = 35_000;
export const DEFAULT_SESSION_TTL_HOURS = 10;

export function numberVar(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
