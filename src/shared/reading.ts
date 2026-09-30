import { CARD_BY_ID } from './cards.ts';
import { SPREAD_SIZE } from './spread.ts';
import { TOPIC_BY_ID } from './topics.ts';
import type { DrawnCard, Reading, ReadingRequest } from './types.ts';

/*
 * AI 해석의 입력·출력 계약
 * - 입력: 주제 ID, 카드 ID·방향(선택 순서대로 3장), 요청 ID
 * - 출력: 카드별 해석 3개 + 종합 + 인쇄용 문장
 * 목표 길이(target)는 AI에게 안내하는 값, 최대 길이(max)는 서버가 거부하는 기준입니다.
 * 인쇄 문장의 max는 4×6·2×3 인쇄 레이아웃에 들어가도록 정했습니다.
 */

export interface FieldLimit {
  target: number;
  max: number;
}

export const LIMITS = {
  card: {
    headline: { target: 45, max: 90 },
    symbolism: { target: 150, max: 320 },
    topicReading: { target: 190, max: 400 },
    action: { target: 70, max: 150 },
  },
  summary: {
    title: { target: 20, max: 40 },
    conclusion: { target: 60, max: 120 },
    combined: { target: 260, max: 560 },
    caution: { target: 90, max: 200 },
    prepare: { target: 90, max: 200 },
    todayAction: { target: 70, max: 150 },
  },
  print: {
    headline: { target: 32, max: 50 },
    advice: { target: 60, max: 90 },
    caution: { target: 45, max: 75 },
    cheer: { target: 28, max: 45 },
    miniAdvice: { target: 28, max: 40 },
    miniCaution: { target: 24, max: 36 },
  },
} as const satisfies Record<string, Record<string, FieldLimit>>;

export class ReadingFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadingFormatError';
  }
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 브라우저가 보낸 해석 요청을 서버 데이터 기준으로 검증합니다. */
export function validateReadingRequest(input: unknown): ValidationResult<ReadingRequest> {
  if (!isRecord(input)) return { ok: false, message: '요청 형식이 올바르지 않습니다.' };
  const { topicId, cards, requestId } = input;

  if (typeof topicId !== 'string' || !TOPIC_BY_ID.has(topicId)) {
    return { ok: false, message: '알 수 없는 운세 주제입니다.' };
  }
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return { ok: false, message: '요청 ID가 올바르지 않습니다.' };
  }
  if (!Array.isArray(cards) || cards.length !== SPREAD_SIZE) {
    return { ok: false, message: `카드는 정확히 ${SPREAD_SIZE}장이어야 합니다.` };
  }

  const seen = new Set<string>();
  const drawn: DrawnCard[] = [];
  for (const item of cards) {
    if (!isRecord(item)) return { ok: false, message: '카드 정보가 올바르지 않습니다.' };
    const { id, reversed } = item;
    if (typeof id !== 'string' || !CARD_BY_ID.has(id)) {
      return { ok: false, message: '알 수 없는 카드입니다.' };
    }
    if (typeof reversed !== 'boolean') {
      return { ok: false, message: '카드 방향 정보가 올바르지 않습니다.' };
    }
    if (seen.has(id)) return { ok: false, message: '같은 카드를 두 번 고를 수 없습니다.' };
    seen.add(id);
    drawn.push({ id, reversed });
  }

  return { ok: true, value: { topicId, cards: drawn, requestId } };
}

type JsonSchema = Record<string, unknown>;

function str(description: string, limit: FieldLimit): JsonSchema {
  return { type: 'string', description: `${description} (한국어, 약 ${limit.target}자 이내)` };
}

/** Gemini 구조화 출력용 JSON Schema. 카드 ID는 이번 요청의 3장으로만 제한합니다. */
export function buildReadingSchema(cardIds: readonly string[]): JsonSchema {
  const c = LIMITS.card;
  const s = LIMITS.summary;
  const p = LIMITS.print;
  return {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        description: '학생이 고른 순서(지금의 나 → 다가오는 흐름 → 나에게 필요한 행동)대로 정확히 3개',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            cardId: { type: 'string', enum: [...cardIds], description: '해석하는 카드의 ID' },
            headline: str('이 카드 자리의 한 문장 결론', c.headline),
            symbolism: str('카드 그림의 상징과 정·역방향 의미 설명', c.symbolism),
            topicReading: str('선택한 주제에 비추어 본 구체적인 해석', c.topicReading),
            action: str('오늘 바로 해 볼 수 있는 작은 행동 한 가지', c.action),
          },
          required: ['cardId', 'headline', 'symbolism', 'topicReading', 'action'],
        },
      },
      summary: {
        type: 'object',
        properties: {
          title: str('세 카드를 아우르는 짧은 제목', s.title),
          conclusion: str('종합 핵심 결론 한 문장', s.conclusion),
          combined: str('세 장을 함께 읽었을 때의 의미', s.combined),
          caution: str('조심하면 좋은 점', s.caution),
          prepare: str('준비하면 좋은 점', s.prepare),
          todayAction: str('오늘 실천할 작은 행동', s.todayAction),
        },
        required: ['title', 'conclusion', 'combined', 'caution', 'prepare', 'todayAction'],
      },
      print: {
        type: 'object',
        description: '기념 카드 인쇄용 짧은 문장. 종합 해석과 같은 의미를 짧게 줄인 것',
        properties: {
          headline: str('인쇄용 짧은 결론', p.headline),
          advice: str('인쇄용 조언', p.advice),
          caution: str('인쇄용 주의점', p.caution),
          cheer: str('인쇄용 응원 문장', p.cheer),
          miniAdvice: str('작은 카드용 아주 짧은 조언', p.miniAdvice),
          miniCaution: str('작은 카드용 아주 짧은 주의점', p.miniCaution),
        },
        required: ['headline', 'advice', 'caution', 'cheer', 'miniAdvice', 'miniCaution'],
      },
    },
    required: ['cards', 'summary', 'print'],
  };
}

// 제어 문자(줄바꿈·탭 제외)와 마크다운 강조 기호를 제거합니다.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const FAKE_PROBABILITY = /\d+(\.\d+)?\s*(%|퍼센트|프로(?![그젝필세]))/;

export function cleanText(value: string): string {
  return value
    .replace(CONTROL_CHARS, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readField(obj: Record<string, unknown>, key: string, limit: FieldLimit, path: string): string {
  const raw = obj[key];
  if (typeof raw !== 'string') throw new ReadingFormatError(`${path}.${key} 값이 문자열이 아닙니다.`);
  const text = cleanText(raw);
  if (text.length === 0) throw new ReadingFormatError(`${path}.${key} 값이 비어 있습니다.`);
  if (text.length > limit.max) throw new ReadingFormatError(`${path}.${key} 값이 너무 깁니다(${text.length}자).`);
  if (FAKE_PROBABILITY.test(text)) {
    throw new ReadingFormatError(`${path}.${key}에 꾸며 낸 확률 표현이 있습니다.`);
  }
  return text;
}

/**
 * 모델이 준 JSON 문자열을 검증해 Reading으로 바꿉니다.
 * - 카드 3장이 요청한 ID와 정확히 일치해야 합니다(순서가 다르면 요청 순서로 정렬).
 * - 모든 필드는 비어 있지 않고 최대 길이 이하여야 합니다.
 */
export function parseReading(jsonText: string, expectedIds: readonly string[]): Reading {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new ReadingFormatError('JSON 형식이 아닙니다.');
  }
  if (!isRecord(data)) throw new ReadingFormatError('최상위 값이 객체가 아닙니다.');

  const { cards, summary, print } = data;
  if (!Array.isArray(cards) || cards.length !== expectedIds.length) {
    throw new ReadingFormatError('카드 해석 개수가 맞지 않습니다.');
  }

  const byId = new Map<string, Reading['cards'][number]>();
  cards.forEach((item, index) => {
    if (!isRecord(item)) throw new ReadingFormatError(`cards[${index}]가 객체가 아닙니다.`);
    const cardId = item.cardId;
    if (typeof cardId !== 'string' || !expectedIds.includes(cardId)) {
      throw new ReadingFormatError(`cards[${index}]의 카드 ID가 요청과 다릅니다.`);
    }
    if (byId.has(cardId)) throw new ReadingFormatError('같은 카드 해석이 중복되었습니다.');
    const path = `cards[${index}]`;
    const l = LIMITS.card;
    byId.set(cardId, {
      cardId,
      headline: readField(item, 'headline', l.headline, path),
      symbolism: readField(item, 'symbolism', l.symbolism, path),
      topicReading: readField(item, 'topicReading', l.topicReading, path),
      action: readField(item, 'action', l.action, path),
    });
  });
  const orderedCards = expectedIds.map((id) => {
    const card = byId.get(id);
    if (!card) throw new ReadingFormatError(`카드 ${id} 해석이 없습니다.`);
    return card;
  });

  if (!isRecord(summary)) throw new ReadingFormatError('종합 해석이 없습니다.');
  if (!isRecord(print)) throw new ReadingFormatError('인쇄용 문장이 없습니다.');
  const s = LIMITS.summary;
  const p = LIMITS.print;

  return {
    cards: orderedCards,
    summary: {
      title: readField(summary, 'title', s.title, 'summary'),
      conclusion: readField(summary, 'conclusion', s.conclusion, 'summary'),
      combined: readField(summary, 'combined', s.combined, 'summary'),
      caution: readField(summary, 'caution', s.caution, 'summary'),
      prepare: readField(summary, 'prepare', s.prepare, 'summary'),
      todayAction: readField(summary, 'todayAction', s.todayAction, 'summary'),
    },
    print: {
      headline: readField(print, 'headline', p.headline, 'print'),
      advice: readField(print, 'advice', p.advice, 'print'),
      caution: readField(print, 'caution', p.caution, 'print'),
      cheer: readField(print, 'cheer', p.cheer, 'print'),
      miniAdvice: readField(print, 'miniAdvice', p.miniAdvice, 'print'),
      miniCaution: readField(print, 'miniCaution', p.miniCaution, 'print'),
    },
  };
}

/** 클라이언트가 받은 응답도 같은 규칙으로 한 번 더 확인할 때 사용 */
export function isReading(value: unknown, expectedIds: readonly string[]): value is Reading {
  try {
    parseReading(JSON.stringify(value), expectedIds);
    return true;
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
