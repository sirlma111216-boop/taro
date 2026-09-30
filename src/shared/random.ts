/*
 * 암호학적 난수(crypto.getRandomValues) 기반 셔플.
 * Math.random 대신 Web Crypto를 쓰고, 모듈로 편향이 없도록 거부 샘플링을 합니다.
 */

type RandomSource = (buffer: Uint32Array<ArrayBuffer>) => void;

const defaultSource: RandomSource = (buffer) => {
  crypto.getRandomValues(buffer);
};

/** 0 이상 max 미만의 균일한 정수 */
export function randomInt(max: number, source: RandomSource = defaultSource): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) {
    throw new RangeError(`randomInt 범위 오류: ${max}`);
  }
  const range = 2 ** 32;
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  for (;;) {
    source(buf);
    const value = buf[0] ?? 0;
    if (value < limit) return value % max;
  }
}

/** Fisher–Yates 셔플 (원본을 바꾸지 않고 새 배열 반환) */
export function shuffle<T>(items: readonly T[], source: RandomSource = defaultSource): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, source);
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

/** probability 확률로 true (0~1) */
export function chance(probability: number, source: RandomSource = defaultSource): boolean {
  const scale = 1_000_000;
  return randomInt(scale, source) < Math.round(probability * scale);
}

export function randomId(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
