import { getCard, orientationLabel } from '../shared/cards.ts';
import { parseReading } from '../shared/reading.ts';
import { positionAt } from '../shared/spread.ts';
import { getTopic } from '../shared/topics.ts';
import type { Reading, ReadingRequest } from '../shared/types.ts';
import { GeminiError } from './gemini.ts';

/*
 * 테스트 전용 모의 응답
 * - AI_MODE=mock 이고 요청 주소가 localhost일 때만 사용됩니다(서버에서 강제).
 * - 모든 문장 앞에 [모의]를 붙이고, 화면에도 "테스트용 모의 응답" 배지를 띄웁니다.
 * - 실제 AI가 쓴 해석처럼 보이지 않도록 카드 데이터 문장을 그대로 나열합니다.
 * - X-Mock-Scenario 헤더로 지연·오류 상황을 흉내 내 화면의 오류 처리를 시험합니다.
 */

export type MockScenario = 'ok' | 'slow' | 'hang' | 'error' | 'bad-json' | 'quota' | 'blocked';

export function parseScenario(value: string | null): MockScenario {
  const allowed: MockScenario[] = ['ok', 'slow', 'hang', 'error', 'bad-json', 'quota', 'blocked'];
  return allowed.includes(value as MockScenario) ? (value as MockScenario) : 'ok';
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

export function buildMockReading(request: ReadingRequest): Reading {
  const topic = getTopic(request.topicId);
  const cards = request.cards.map((drawn, index) => {
    const card = getCard(drawn.id);
    if (!card) throw new Error('알 수 없는 카드');
    const meaning = drawn.reversed ? card.reversed : card.upright;
    const position = positionAt(index);
    return {
      cardId: card.id,
      headline: `[모의] ${position.name}: ${meaning.keywords.join(' · ')}`,
      symbolism: `[모의] ${card.nameKo}(${orientationLabel(drawn.reversed)})의 상징은 ${card.symbols.slice(0, 2).join(', ')}입니다. ${meaning.meaning}`,
      topicReading: `[모의] '${topic?.name ?? ''}' 주제에 대한 실제 AI 해석이 들어갈 자리입니다. 이 문장은 화면 배치를 시험하기 위한 테스트 문장입니다.`,
      action: `[모의] ${position.short} 카드의 작은 행동 제안이 들어갈 자리입니다.`,
    };
  });
  const names = request.cards.map((d) => getCard(d.id)?.nameKo ?? d.id).join(', ');
  return {
    cards,
    summary: {
      title: '[모의] 테스트 해석',
      conclusion: '[모의] 실제 Gemini 해석이 아닌 테스트용 종합 결론입니다.',
      combined: `[모의] 고른 카드: ${names}. 이 영역에는 세 장을 함께 읽은 종합 해석이 들어갑니다. 화면의 줄바꿈과 글자 크기를 확인하기 위해 적당한 길이의 테스트 문장을 넣었습니다.`,
      caution: '[모의] 조심할 점이 들어갈 자리입니다.',
      prepare: '[모의] 준비하면 좋은 점이 들어갈 자리입니다.',
      todayAction: '[모의] 오늘의 작은 행동이 들어갈 자리입니다.',
    },
    print: {
      headline: '[모의] 테스트용 인쇄 결론 문장',
      advice: '[모의] 인쇄용 조언이 들어갈 자리입니다. 실제 결과가 아닙니다.',
      caution: '[모의] 인쇄용 주의점이 들어갈 자리입니다.',
      cheer: '[모의] 응원 문장 자리',
      miniAdvice: '[모의] 짧은 조언 자리',
      miniCaution: '[모의] 짧은 주의 자리',
    },
  };
}

export async function runMockScenario(
  request: ReadingRequest,
  scenario: MockScenario,
  signal?: AbortSignal,
): Promise<Reading> {
  const ids = request.cards.map((c) => c.id);
  switch (scenario) {
    case 'slow':
      await sleep(6_000, signal);
      break;
    case 'hang':
      await sleep(120_000, signal);
      break;
    case 'error':
      await sleep(400, signal);
      throw new GeminiError('upstream', '모의 오류: AI 서버가 일시적으로 응답하지 않습니다.', 503);
    case 'quota':
      throw new GeminiError('quota', '모의 오류: AI 사용량 한도', 429, 20);
    case 'blocked':
      throw new GeminiError('blocked', '모의 오류: 안전 정책 차단');
    case 'bad-json':
      await sleep(300, signal);
      // 실제 검증 경로(parseReading)를 거쳐 형식 오류가 나는지 확인합니다.
      parseReading('{"cards": [{"cardId": "wrong"}]}', ids);
      break;
    default:
      await sleep(900, signal);
  }
  return parseReading(JSON.stringify(buildMockReading(request)), ids);
}
