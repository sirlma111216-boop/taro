import { DurableObject } from 'cloudflare:workers';
import type { DailyCodeRecord } from './daily-code.ts';

/*
 * 일일 코드 저장용 Durable Object (SQLite 저장소, 무료 플랜 사용 가능)
 * Worker 인스턴스가 여러 개여도 이 객체 하나만 읽고 쓰므로, 코드를 만들자마자 모든 기기에서 바로 쓸 수 있습니다.
 * 기간이 끝난 코드는 읽을 때 지웁니다.
 */
export class DailyCodeStore extends DurableObject {
  async current(): Promise<DailyCodeRecord | null> {
    const record = await this.ctx.storage.get<DailyCodeRecord>('current');
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      await this.ctx.storage.delete('current');
      return null;
    }
    return record;
  }

  async replace(record: DailyCodeRecord): Promise<void> {
    await this.ctx.storage.put('current', record);
  }

  async clear(): Promise<void> {
    await this.ctx.storage.delete('current');
  }
}
