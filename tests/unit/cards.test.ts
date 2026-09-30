import { describe, expect, it } from 'vitest';
import { CARDS, CARD_BY_ID, cardImagePath, getCard, SUIT_ORDER } from '../../src/shared/cards.ts';
import { isValidCardId } from '../../scripts/card-art.ts';

describe('78장 카드 데이터', () => {
  it('정확히 78장이고 ID가 중복되지 않는다', () => {
    expect(CARDS).toHaveLength(78);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(78);
    expect(CARD_BY_ID.size).toBe(78);
  });

  it('메이저 22장은 0~21번이 빠짐없이 있다', () => {
    const majors = CARDS.filter((c) => c.arcana === 'major');
    expect(majors).toHaveLength(22);
    expect(majors.map((c) => c.number)).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(majors.every((c) => c.suit === null && c.rank === null)).toBe(true);
    expect(majors.map((c) => c.id)).toEqual(Array.from({ length: 22 }, (_, i) => `major-${String(i).padStart(2, '0')}`));
  });

  it('라이더–웨이트 순서: 8번은 힘, 11번은 정의', () => {
    expect(getCard('major-08')?.nameEn).toBe('Strength');
    expect(getCard('major-11')?.nameEn).toBe('Justice');
    expect(getCard('major-13')?.nameKo).toBe('죽음');
    expect(getCard('major-17')?.nameKo).toBe('별');
    expect(getCard('major-18')?.nameKo).toBe('달');
    expect(getCard('major-19')?.nameKo).toBe('태양');
  });

  it('네 슈트가 각각 에이스~킹 14장이다', () => {
    for (const suit of SUIT_ORDER) {
      const cards = CARDS.filter((c) => c.suit === suit);
      expect(cards).toHaveLength(14);
      expect(cards.map((c) => c.number)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
      expect(cards[0]?.rank).toBe('ace');
      expect(cards[10]?.rank).toBe('page');
      expect(cards[11]?.rank).toBe('knight');
      expect(cards[12]?.rank).toBe('queen');
      expect(cards[13]?.rank).toBe('king');
    }
    expect(getCard('cups-14')?.nameEn).toBe('King of Cups');
    expect(getCard('swords-01')?.nameKo).toBe('소드 에이스');
  });

  it('모든 카드에 이름·상징·정/역방향 의미·그림 설명이 있다', () => {
    for (const card of CARDS) {
      expect(card.nameKo.length, card.id).toBeGreaterThan(0);
      expect(card.nameEn.length, card.id).toBeGreaterThan(0);
      expect(card.symbols.length, card.id).toBeGreaterThan(0);
      expect(card.upright.keywords.length, card.id).toBeGreaterThan(0);
      expect(card.reversed.keywords.length, card.id).toBeGreaterThan(0);
      expect(card.upright.meaning.length, card.id).toBeGreaterThan(10);
      expect(card.reversed.meaning.length, card.id).toBeGreaterThan(10);
      expect(card.upright.meaning, card.id).not.toBe(card.reversed.meaning);
      expect(card.art.length, card.id).toBeGreaterThan(20);
      expect(card.label.length, card.id).toBeGreaterThan(0);
    }
  });

  it('카드 ID와 이미지 파일 경로가 1:1로 대응한다', () => {
    for (const card of CARDS) {
      expect(isValidCardId(card.id), card.id).toBe(true);
      expect(cardImagePath(card.id)).toBe(`assets/cards/${card.id}.webp`);
    }
    expect(isValidCardId('major-22')).toBe(false);
    expect(isValidCardId('cups-15')).toBe(false);
    expect(isValidCardId('card-back')).toBe(false);
  });

  it('무겁게 들릴 수 있는 카드에는 AI 해석 지침이 있다', () => {
    for (const id of ['major-13', 'major-15', 'major-16', 'swords-10', 'swords-03']) {
      expect(getCard(id)?.guidance, id).toBeTruthy();
    }
  });
});
