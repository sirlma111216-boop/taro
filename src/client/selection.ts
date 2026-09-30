import type { TableCard } from '../shared/deck.ts';
import { SPREAD_SIZE } from '../shared/spread.ts';
import type { DrawnCard } from '../shared/types.ts';

/*
 * 카드 선택 상태 (화면과 분리된 순수 로직)
 * - 같은 카드를 두 번 고를 수 없습니다.
 * - 3장이 차면 더 고를 수 없습니다.
 * - AI 요청 전까지는 마지막으로 고른 카드부터 되돌릴 수 있습니다.
 * - 잠금(lock) 중에는 클릭을 무시해 빠른 연속 클릭을 막습니다.
 */
export class CardSelection {
  private readonly table: readonly TableCard[];
  private readonly picks: TableCard[] = [];
  private locked = false;
  private confirmed = false;

  constructor(table: readonly TableCard[]) {
    this.table = table;
  }

  get picked(): readonly TableCard[] {
    return this.picks;
  }

  get count(): number {
    return this.picks.length;
  }

  get isComplete(): boolean {
    return this.picks.length === SPREAD_SIZE;
  }

  get isConfirmed(): boolean {
    return this.confirmed;
  }

  isPicked(slot: number): boolean {
    return this.picks.some((p) => p.slot === slot);
  }

  /** 선택 가능하면 몇 번째(0부터) 자리에 놓이는지 돌려주고, 아니면 null */
  pick(slot: number): number | null {
    if (this.locked || this.confirmed || this.isComplete) return null;
    const card = this.table.find((c) => c.slot === slot);
    if (!card || this.isPicked(slot)) return null;
    this.picks.push(card);
    return this.picks.length - 1;
  }

  undo(): TableCard | null {
    if (this.locked || this.confirmed) return null;
    return this.picks.pop() ?? null;
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** 해석 시작: 이후에는 선택을 바꿀 수 없습니다. */
  confirm(): DrawnCard[] | null {
    if (!this.isComplete || this.confirmed) return null;
    this.confirmed = true;
    return this.picks.map(({ id, reversed }) => ({ id, reversed }));
  }
}
