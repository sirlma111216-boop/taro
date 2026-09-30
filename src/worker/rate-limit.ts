import type { RateLimiter } from './env.ts';

/*
 * 요청 제한
 * 1) Cloudflare Rate Limiting 바인딩(wrangler.jsonc의 ratelimits)을 우선 사용합니다.
 *    이 제한은 Cloudflare 위치(데이터센터)별로 계산되며 약간 느슨할 수 있습니다.
 * 2) 바인딩이 없을 때를 대비해 Worker 인스턴스 메모리 안에서도 같은 한도를 적용합니다.
 *    (인스턴스가 여러 개면 인스턴스마다 따로 세므로 '최선의 노력' 수준입니다.)
 * 3) 로그인 실패가 반복되면 메모리 기반 잠금을 추가로 겁니다.
 */

export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limitCount: number;
  private readonly periodMs: number;
  private readonly now: () => number;

  constructor(limitCount: number, periodMs: number, now: () => number = Date.now) {
    this.limitCount = limitCount;
    this.periodMs = periodMs;
    this.now = now;
  }

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => t - time < this.periodMs);
    if (recent.length >= this.limitCount) {
      this.hits.set(key, recent);
      return { success: false };
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(t);
    return { success: true };
  }

  private prune(t: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((time) => t - time >= this.periodMs)) this.hits.delete(key);
    }
  }
}

/** 바인딩과 메모리 제한을 함께 적용합니다. 어느 한쪽이라도 거부하면 거부합니다. */
export async function checkLimit(
  binding: RateLimiter | undefined,
  fallback: RateLimiter,
  key: string,
): Promise<boolean> {
  const memory = await fallback.limit({ key });
  if (!memory.success) return false;
  if (!binding) return true;
  try {
    const result = await binding.limit({ key });
    return result.success;
  } catch {
    // 바인딩 오류 때문에 운영이 멈추지 않도록 메모리 제한 결과를 따릅니다.
    return true;
  }
}

/** 로그인 실패 누적 잠금: windowMs 안에 maxFailures번 실패하면 lockMs 동안 잠급니다. */
export class FailureLockout {
  private readonly failures = new Map<string, { count: number; first: number; lockedUntil: number }>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(maxFailures = 8, windowMs = 15 * 60_000, lockMs = 15 * 60_000, now: () => number = Date.now) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.now = now;
  }

  lockedFor(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    const remaining = entry.lockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(key: string): void {
    const t = this.now();
    const entry = this.failures.get(key);
    if (!entry || t - entry.first > this.windowMs) {
      this.failures.set(key, { count: 1, first: t, lockedUntil: 0 });
      return;
    }
    entry.count += 1;
    if (entry.count >= this.maxFailures) entry.lockedUntil = t + this.lockMs;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}
