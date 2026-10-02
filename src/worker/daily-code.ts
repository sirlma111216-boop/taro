import { randomId, randomInt } from '../shared/random.ts';
import type { DailyCodeInfo } from '../shared/types.ts';
import { constantTimeEqual, sha256 } from './crypto.ts';

/*
 * 일일 입장 코드
 * - 운영자(관리자)가 만들면 만든 때부터 24시간 동안, 그 코드로 운영자 비밀번호 없이 부스를 열 수 있습니다.
 * - 코드는 한 번에 하나만 있습니다. 새로 만들거나 끄면 이전 코드와, 그 코드로 들어온 기기의 로그인이 모두 끝납니다.
 * - 코드는 숫자 8자리(1억 가지)이고, 로그인과 같은 요청 제한·실패 잠금을 받습니다.
 * - 저장은 Durable Object(DailyCodeStore) 하나에 합니다. 모든 Worker 인스턴스가 같은 값을 즉시 봅니다.
 */

export const DAILY_CODE_TTL_MS = 24 * 3600_000;
export const DAILY_CODE_DIGITS = 8;

export interface DailyCodeRecord {
  /** 코드 세대 번호. 세션 쿠키에 넣어, 코드가 바뀌면 그 코드로 들어온 세션을 끝냅니다. */
  id: string;
  code: string;
  createdAt: number;
  expiresAt: number;
}

/** 일일 코드 저장소 (운영: Durable Object, 테스트: 메모리) */
export interface CodeStore {
  current(): Promise<DailyCodeRecord | null>;
  replace(record: DailyCodeRecord): Promise<void>;
  clear(): Promise<void>;
}

export function newDailyCode(now = Date.now()): DailyCodeRecord {
  const code = String(randomInt(10 ** DAILY_CODE_DIGITS)).padStart(DAILY_CODE_DIGITS, '0');
  return { id: randomId(12), code, createdAt: now, expiresAt: now + DAILY_CODE_TTL_MS };
}

/** "4827 1593", "4827-1593", 전각 숫자 등을 숫자 8자리로 정리합니다. 형식이 다르면 null */
export function normalizeCode(input: string): string | null {
  const digits = input.normalize('NFKC').replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${DAILY_CODE_DIGITS}}$`).test(digits) ? digits : null;
}

export function isActive(record: DailyCodeRecord | null, now = Date.now()): record is DailyCodeRecord {
  return Boolean(record && record.expiresAt > now);
}

/** 입력한 코드가 지금 쓸 수 있는 코드와 같은지 (같은 시간이 걸리도록 해시로 비교) */
export async function codeMatches(record: DailyCodeRecord | null, input: string, now = Date.now()): Promise<boolean> {
  const code = normalizeCode(input);
  if (!code || !isActive(record, now)) return false;
  const [given, expected] = await Promise.all([sha256(code), sha256(record.code)]);
  return constantTimeEqual(given, expected);
}

export function toInfo(record: DailyCodeRecord | null, now = Date.now()): DailyCodeInfo | null {
  return isActive(record, now) ? { code: record.code, createdAt: record.createdAt, expiresAt: record.expiresAt } : null;
}

export class MemoryCodeStore implements CodeStore {
  private record: DailyCodeRecord | null = null;

  async current(): Promise<DailyCodeRecord | null> {
    return this.record;
  }

  async replace(record: DailyCodeRecord): Promise<void> {
    this.record = { ...record };
  }

  async clear(): Promise<void> {
    this.record = null;
  }
}

/**
 * Durable Object 바인딩(DAILY_CODE) 가운데 이 앱이 쓰는 부분만 적은 형태입니다(env.ts 의 RateLimiter 처럼).
 * 실제 객체는 daily-code-store.ts 의 DailyCodeStore 이고, 메서드는 RPC로 호출됩니다.
 */
export interface DailyCodeNamespace<Id = unknown> {
  idFromName(name: string): Id;
  get(id: Id): CodeStore;
}

/** 코드는 이름이 고정된 객체 하나에만 저장합니다. */
export function durableCodeStore(namespace: DailyCodeNamespace): CodeStore {
  const stub = () => namespace.get(namespace.idFromName('daily-code'));
  return {
    current: async () => (await stub().current()) ?? null,
    replace: (record) => stub().replace(record),
    clear: () => stub().clear(),
  };
}
