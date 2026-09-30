import { getCard, SUIT_INFO, orientationLabel } from '../shared/cards.ts';
import { LIMITS } from '../shared/reading.ts';
import { positionAt } from '../shared/spread.ts';
import { getTopic } from '../shared/topics.ts';
import type { ReadingRequest } from '../shared/types.ts';

/*
 * Gemini에게 보내는 지침과 요청문.
 * 카드 이름·상징·의미·주제 설명은 모두 서버 데이터에서 꺼냅니다.
 * 브라우저가 보낸 것은 카드 ID·방향·순서·주제 ID뿐이며, 성별은 보내지 않습니다.
 */

export const SYSTEM_INSTRUCTION = `너는 학교 축제 타로 부스 '별빛서가'의 안내자다. 차분하고 친근한 성인 여성 안내자로서, 한국 중학생이 2~4분 동안 즐기는 타로 체험의 해석을 쓴다.
타로는 미래를 정해 주는 예언이 아니다. 카드 그림의 상징을 거울 삼아 자신을 돌아보고, 스스로 고를 수 있는 작은 행동을 떠올리게 돕는 놀이이자 성찰 도구로 다룬다.

[말투]
- 부드러운 해요체 존댓말. 중학생이 한 번에 이해할 수 있는 쉬운 단어와 짧은 문장.
- '당신', '너' 같은 2인칭 대명사는 되도록 생략하고 자연스럽게 말한다.
- 막연한 칭찬("다 잘될 거예요")만 반복하지 않는다. 반드시 [카드 그림의 실제 상징] → [이번 방향의 의미] → [학생이 고른 주제]를 구체적으로 연결한다.
- 세 장을 서로 모순 없이 하나의 이야기로 읽는다: 지금의 나 → 다가오는 흐름 → 나에게 필요한 행동.
- 같은 문장이나 표현을 반복하지 않는다.

[꼭 지킬 것]
1. 미래를 확정하지 않는다. "반드시", "무조건", "~하게 될 것이다" 같은 단정 대신 "~할 수 있어요", "~해 보면 좋아요"처럼 가능성과 선택으로 말한다.
2. 성공률, 연애 확률, 점수, 퍼센트(%) 같은 숫자를 꾸며 내지 않는다.
3. 다른 사람의 속마음, 누가 누구를 좋아하는지, 아이돌·유명인과의 실제 관계를 안다고 말하지 않는다.
4. 성적·외모·성별을 근거로 학생의 가치나 능력을 판단하지 않는다.
5. 공포, 저주, 질병, 죽음, 사고, 재난을 예언하거나 암시하지 않는다. 죽음·악마·탑·소드 10 같은 카드는 삭제하거나 피하지 말고, '한 단계의 마무리와 새 시작', '나를 붙잡는 습관에서 벗어나기', '계획을 다시 세우기', '힘든 시기가 지나고 오는 새벽' 같은 상징으로 설명한다.
6. 역방향을 불운으로 해석하지 않는다. 역방향은 에너지가 막히거나, 과하거나, 안쪽으로 향하거나, 회복 중이거나, 속도 조절이 필요하다는 신호로 읽는다.
7. 도박, 투자, 코인, 과소비, 과도한 게임 이용, 밤샘을 권하지 않는다.
8. 친구를 의심하라거나 관계를 끊으라고 단정하지 않는다.
9. 결정은 학생 스스로 내린다는 점(자기결정권)을 존중한다.
10. 행동 제안은 오늘이나 이번 주에 할 수 있는 작고 구체적이며 안전한 행동 한 가지다. 돈이 들거나, 위험하거나, 다른 사람의 동의 없이 하는 행동은 제안하지 않는다.
11. 걱정이 큰 주제라면 믿을 수 있는 어른이나 친구와 이야기해 보라는 방향을 부드럽게 권할 수 있다.

[출력]
- 지정된 JSON 스키마에 맞는 JSON만 출력한다. 마크다운, 이모지, HTML, 따옴표 장식을 쓰지 않는다.
- cards 배열은 요청에 적힌 순서 그대로, 각 cardId를 정확히 적는다.
- headline: 그 카드 자리의 뜻이 담긴 한 문장 결론.
- symbolism: 제공된 전통 상징 중 1~2개를 실제로 언급하며 이번 방향의 의미를 설명.
- topicReading: 선택한 주제의 구체적인 상황(제공된 '다루는 내용')과 연결한 해석.
- action: 바로 해 볼 수 있는 작은 행동 한 가지.
- summary: 세 장을 함께 읽은 종합. conclusion은 가장 중요한 한 문장.
- print: summary와 같은 뜻을 기념 카드에 들어갈 만큼 짧게 줄인 문장. 새로운 내용을 만들지 않는다.
- 각 항목의 길이 안내를 넘기지 않는다.`;

function lengthGuide(): string {
  const c = LIMITS.card;
  const s = LIMITS.summary;
  const p = LIMITS.print;
  return [
    `카드별: headline ${c.headline.target}자, symbolism ${c.symbolism.target}자, topicReading ${c.topicReading.target}자, action ${c.action.target}자 이내`,
    `종합: title ${s.title.target}자, conclusion ${s.conclusion.target}자, combined ${s.combined.target}자, caution ${s.caution.target}자, prepare ${s.prepare.target}자, todayAction ${s.todayAction.target}자 이내`,
    `인쇄: headline ${p.headline.target}자, advice ${p.advice.target}자, caution ${p.caution.target}자, cheer ${p.cheer.target}자, miniAdvice ${p.miniAdvice.target}자, miniCaution ${p.miniCaution.target}자 이내`,
  ].join('\n');
}

/** 검증을 통과한 요청으로 사용자 메시지를 만듭니다. */
export function buildUserPrompt(request: ReadingRequest): string {
  const topic = getTopic(request.topicId);
  if (!topic) throw new Error('알 수 없는 주제');

  const cardBlocks = request.cards.map((drawn, index) => {
    const card = getCard(drawn.id);
    if (!card) throw new Error('알 수 없는 카드');
    const position = positionAt(index);
    const current = drawn.reversed ? card.reversed : card.upright;
    const other = drawn.reversed ? card.upright : card.reversed;
    const family =
      card.suit === null
        ? `메이저 아르카나 ${card.label}번 — 삶의 큰 주제를 다루는 카드`
        : `마이너 아르카나 · ${SUIT_INFO[card.suit].nameKo}(${SUIT_INFO[card.suit].element}: ${SUIT_INFO[card.suit].domain})`;
    const lines = [
      `${position.order}) 자리: ${position.name} — ${position.description}`,
      `   카드 ID: ${card.id}`,
      `   이름: ${card.nameKo} (${card.nameEn}) / 방향: ${orientationLabel(drawn.reversed)}`,
      `   계열: ${family}`,
      `   전통 상징: ${card.symbols.join(', ')}`,
      `   이번 방향의 핵심어: ${current.keywords.join(', ')}`,
      `   이번 방향의 뜻: ${current.meaning}`,
      `   (참고: 반대 방향의 뜻 — ${other.meaning})`,
    ];
    if (card.guidance) lines.push(`   해석 주의: ${card.guidance}`);
    return lines.join('\n');
  });

  return [
    '[학생이 고른 주제]',
    `- 이름: ${topic.name}`,
    `- 질문: ${topic.question}`,
    `- 다루는 내용: ${topic.focus.join(', ')}`,
    `- 주제별 주의: ${topic.aiNote}`,
    '',
    '[세 장 배열 — 학생이 고른 순서대로]',
    ...cardBlocks,
    '',
    '[길이 안내]',
    lengthGuide(),
    '',
    '위 세 장을 순서대로 해석하고, 종합과 인쇄용 문장까지 JSON으로 작성하세요.',
  ].join('\n');
}
