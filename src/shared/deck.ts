import { CARDS } from './cards.ts';
import { chance, shuffle } from './random.ts';
import type { DrawnCard } from './types.ts';

/** 테이블에 펼칠 카드 수 (78장 전체를 섞은 뒤 맨 위에서부터 뽑음) */
export const TABLE_CARD_COUNT = 15;

/**
 * 역방향이 나올 확률.
 * 실제 덱을 섞으면 약 50%가 뒤집히지만, 짧은 축제 체험에서 역방향이 몰려
 * 부담스럽지 않도록 35%로 정했습니다. 역방향도 '불운'으로 해석하지 않습니다.
 */
export const REVERSED_PROBABILITY = 0.35;

export interface TableCard extends DrawnCard {
  /** 테이블 위 자리 번호 (0부터) */
  slot: number;
}

/**
 * 78장 전체 덱을 섞고, 위에서부터 count장을 테이블에 펼칩니다.
 * 방향도 이 시점에 정해 두므로 화면이 다시 그려져도 결과가 바뀌지 않습니다.
 */
export function dealTable(count = TABLE_CARD_COUNT, reversedProbability = REVERSED_PROBABILITY): TableCard[] {
  if (count < 3 || count > CARDS.length) throw new RangeError(`펼칠 카드 수 오류: ${count}`);
  const deck = shuffle(CARDS.map((c) => c.id));
  return deck.slice(0, count).map((id, slot) => ({
    id,
    reversed: chance(reversedProbability),
    slot,
  }));
}
