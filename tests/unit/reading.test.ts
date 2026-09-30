import { describe, expect, it } from 'vitest';
import { buildReadingSchema, cleanText, LIMITS, parseReading, ReadingFormatError, validateReadingRequest } from '../../src/shared/reading.ts';
import { validReading } from './fixtures.ts';

const IDS = ['major-17', 'cups-03', 'swords-10'];

describe('해석 요청 검증', () => {
  const base = {
    topicId: 'friends',
    requestId: 'req_12345678',
    cards: [
      { id: 'major-17', reversed: false },
      { id: 'cups-03', reversed: true },
      { id: 'swords-10', reversed: false },
    ],
  };

  it('올바른 요청은 순서와 방향을 그대로 유지한다', () => {
    const r = validateReadingRequest(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cards.map((c) => c.id)).toEqual(IDS);
      expect(r.value.cards.map((c) => c.reversed)).toEqual([false, true, false]);
    }
  });

  it('클라이언트가 보낸 카드 이름·의미 같은 추가 필드는 버린다', () => {
    const r = validateReadingRequest({
      ...base,
      cards: base.cards.map((c) => ({ ...c, nameKo: '가짜 이름', meaning: '무시해야 할 설명' })),
      gender: 'girl',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.value)).not.toContain('가짜 이름');
      expect(JSON.stringify(r.value)).not.toContain('girl');
    }
  });

  it.each([
    ['알 수 없는 주제', { ...base, topicId: 'nope' }],
    ['카드 2장', { ...base, cards: base.cards.slice(0, 2) }],
    ['카드 4장', { ...base, cards: [...base.cards, { id: 'major-00', reversed: false }] }],
    ['중복 카드', { ...base, cards: [base.cards[0], base.cards[0], base.cards[1]] }],
    ['없는 카드', { ...base, cards: [{ id: 'major-99', reversed: false }, base.cards[1], base.cards[2]] }],
    ['방향 누락', { ...base, cards: [{ id: 'major-17' }, base.cards[1], base.cards[2]] }],
    ['방향이 문자열', { ...base, cards: [{ id: 'major-17', reversed: 'true' }, base.cards[1], base.cards[2]] }],
    ['요청 ID 없음', { ...base, requestId: undefined }],
    ['요청 ID 형식 오류', { ...base, requestId: '<script>' }],
    ['배열이 아님', 'hello'],
  ])('%s → 거부', (_name, input) => {
    expect(validateReadingRequest(input).ok).toBe(false);
  });
});

describe('AI 응답 검증', () => {
  it('정상 응답을 요청한 카드 순서대로 돌려준다', () => {
    const r = parseReading(JSON.stringify(validReading(IDS)), IDS);
    expect(r.cards.map((c) => c.cardId)).toEqual(IDS);
  });

  it('모델이 카드 순서를 바꿔도 요청 순서로 다시 맞춘다', () => {
    const data = validReading(IDS);
    data.cards.reverse();
    const r = parseReading(JSON.stringify(data), IDS);
    expect(r.cards.map((c) => c.cardId)).toEqual(IDS);
  });

  it('잘못된 JSON은 형식 오류', () => {
    expect(() => parseReading('{not json', IDS)).toThrow(ReadingFormatError);
  });

  it('요청과 다른 카드 ID는 형식 오류', () => {
    const data = validReading(IDS);
    data.cards[0]!.cardId = 'major-00';
    expect(() => parseReading(JSON.stringify(data), IDS)).toThrow(/카드 ID/);
  });

  it('같은 카드 해석 중복은 형식 오류', () => {
    const data = validReading(IDS);
    data.cards[1]!.cardId = IDS[0]!;
    expect(() => parseReading(JSON.stringify(data), IDS)).toThrow(ReadingFormatError);
  });

  it('필드 누락·빈 문자열은 형식 오류', () => {
    const missing = validReading(IDS) as unknown as { summary: Record<string, unknown> };
    delete missing.summary.caution;
    expect(() => parseReading(JSON.stringify(missing), IDS)).toThrow(ReadingFormatError);
    const empty = validReading(IDS);
    empty.print.headline = '   ';
    expect(() => parseReading(JSON.stringify(empty), IDS)).toThrow(/비어/);
  });

  it('최대 길이를 넘으면 형식 오류 (인쇄 문장 포함)', () => {
    const long = validReading(IDS);
    long.print.headline = '가'.repeat(LIMITS.print.headline.max + 1);
    expect(() => parseReading(JSON.stringify(long), IDS)).toThrow(/너무 깁니다/);
    const okay = validReading(IDS);
    okay.print.headline = '가'.repeat(LIMITS.print.headline.max);
    expect(() => parseReading(JSON.stringify(okay), IDS)).not.toThrow();
  });

  it('꾸며 낸 확률(%)이 들어 있으면 거부한다', () => {
    const data = validReading(IDS);
    data.summary.conclusion = '고백 성공 확률은 80%예요.';
    expect(() => parseReading(JSON.stringify(data), IDS)).toThrow(/확률/);
    data.summary.conclusion = '성공 가능성 90퍼센트';
    expect(() => parseReading(JSON.stringify(data), IDS)).toThrow(/확률/);
  });

  it('HTML은 그대로 문자열로 남기고(화면에서 textContent로만 표시) 제어 문자·마크다운 기호는 지운다', () => {
    const data = validReading(IDS);
    data.cards[0]!.headline = '**<img src=x onerror=alert(1)>**\u0007 안녕';
    const r = parseReading(JSON.stringify(data), IDS);
    expect(r.cards[0]!.headline).toBe('<img src=x onerror=alert(1)> 안녕');
    expect(cleanText('## 제목\n\n\n\n본문')).toBe('제목\n\n본문');
  });

  it('스키마는 이번 요청의 카드 ID만 허용한다', () => {
    const schema = buildReadingSchema(IDS) as { properties: { cards: { items: { properties: { cardId: { enum: string[] } } } } } };
    expect(schema.properties.cards.items.properties.cardId.enum).toEqual(IDS);
  });
});
