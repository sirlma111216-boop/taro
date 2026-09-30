import { describe, expect, it } from 'vitest';
import { CARD_BY_ID } from '../../src/shared/cards.ts';
import { dealTable, TABLE_CARD_COUNT } from '../../src/shared/deck.ts';
import { randomInt, shuffle } from '../../src/shared/random.ts';
import { TOPICS } from '../../src/shared/topics.ts';
import { SPREAD } from '../../src/shared/spread.ts';

describe('운세 주제', () => {
  it('주제 12개, ID 중복 없음, 필수 항목 존재', () => {
    expect(TOPICS).toHaveLength(12);
    expect(new Set(TOPICS.map((t) => t.id)).size).toBe(12);
    for (const t of TOPICS) {
      expect(t.name && t.question && t.description && t.aiNote).toBeTruthy();
      expect(t.focus.length).toBeGreaterThan(0);
    }
  });

  it('배열 위치는 지금의 나 / 다가오는 흐름 / 나에게 필요한 행동', () => {
    expect(SPREAD.map((p) => p.name)).toEqual(['지금의 나', '다가오는 흐름', '나에게 필요한 행동']);
  });
});

describe('셔플과 테이블 펼치기', () => {
  it('shuffle은 원소를 잃거나 복제하지 않는다', () => {
    const items = Array.from({ length: 78 }, (_, i) => i);
    for (let n = 0; n < 50; n++) {
      const out = shuffle(items);
      expect(out).toHaveLength(78);
      expect([...out].sort((a, b) => a - b)).toEqual(items);
    }
  });

  it('randomInt는 범위를 벗어나지 않고 대체로 고르게 분포한다', () => {
    const counts = new Array(6).fill(0) as number[];
    const trials = 60_000;
    for (let i = 0; i < trials; i++) {
      const v = randomInt(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    // 카이제곱 검정 (자유도 5, 유의수준 0.001 임계값 20.52)
    const expected = trials / 6;
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(20.52);
  });

  it('dealTable은 전체 78장에서 중복 없이 15장을 뽑고 방향을 미리 정한다', () => {
    const seenIds = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const table = dealTable();
      expect(table).toHaveLength(TABLE_CARD_COUNT);
      expect(new Set(table.map((c) => c.id)).size).toBe(TABLE_CARD_COUNT);
      table.forEach((c, i) => {
        expect(CARD_BY_ID.has(c.id)).toBe(true);
        expect(typeof c.reversed).toBe('boolean');
        expect(c.slot).toBe(i);
        seenIds.add(c.id);
      });
    }
    // 200번 펼치면 78장 대부분이 한 번 이상 나와야 함(전체 덱에서 뽑는지 확인)
    expect(seenIds.size).toBeGreaterThan(70);
  });

  it('역방향 비율이 설정값(35%) 근처다', () => {
    let reversed = 0;
    let total = 0;
    for (let n = 0; n < 400; n++) {
      for (const c of dealTable()) {
        total++;
        if (c.reversed) reversed++;
      }
    }
    const ratio = reversed / total;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.4);
  });
});
