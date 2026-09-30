import type { PositionId, SpreadPosition } from './types.ts';

/** 세 장 배열: 선택 순서 1·2·3이 곧 배열 위치입니다. */
export const SPREAD: readonly SpreadPosition[] = [
  {
    id: 'present',
    order: 1,
    name: '지금의 나',
    short: '지금',
    description: '지금 내 마음과 상황을 비추는 카드',
  },
  {
    id: 'flow',
    order: 2,
    name: '다가오는 흐름',
    short: '흐름',
    description: '곧 다가올 분위기와 기회를 보여 주는 카드',
  },
  {
    id: 'action',
    order: 3,
    name: '나에게 필요한 행동',
    short: '행동',
    description: '내가 직접 해 볼 수 있는 작은 행동을 알려 주는 카드',
  },
] as const;

export const SPREAD_SIZE = SPREAD.length;

export function positionAt(index: number): SpreadPosition {
  const position = SPREAD[index];
  if (!position) throw new RangeError(`배열 위치가 없습니다: ${index}`);
  return position;
}

export function positionById(id: PositionId): SpreadPosition {
  const position = SPREAD.find((p) => p.id === id);
  if (!position) throw new RangeError(`배열 위치가 없습니다: ${id}`);
  return position;
}
