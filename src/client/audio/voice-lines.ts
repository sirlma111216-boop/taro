import { orientationLabel } from '../../shared/cards.ts';
import type { CardReading, SummaryReading, TarotCard } from '../../shared/types.ts';

/*
 * 장면별 안내 음성 대본 (고정 대본)
 * - id는 음성 파일 이름과 같습니다: public/audio/voice/<id>.mp3
 * - 파일이 없으면 브라우저 음성합성(한국어)으로 읽고, 한국어 음성이 없으면 자막만 보여 줍니다.
 * - docs/voice-script.md 는 이 파일에서 자동 생성됩니다(npm run docs:generate).
 */

export interface VoiceLine {
  id: string;
  scene: string;
  text: string;
  /** 음성 없이 자막으로만 쓰는 줄 */
  captionOnly?: boolean;
}

export const VOICE_LINES = {
  login_done: { id: 'login_done', scene: '로그인 완료', text: '별빛서가의 문이 열렸어요. 이제 첫 번째 손님을 맞이할 준비가 되었습니다.' },
  title: { id: 'title', scene: '타이틀', text: '어서 와요, 별빛서가에 온 걸 환영해요. 세 장의 카드로 내일의 가능성을 함께 펼쳐 볼까요?' },
  gender: { id: 'gender', scene: '성별 선택', text: '먼저 편하게 골라 주세요. 고른 내용은 주제를 보여 주는 순서에만 쓰여요.' },
  topic: { id: 'topic', scene: '주제 선택', text: '오늘은 어떤 이야기가 궁금한가요? 마음이 가는 주제를 하나 골라 주세요.' },
  deal: { id: 'deal', scene: '카드 펼치기', text: '일흔여덟 장의 카드를 섞어서, 그중 열다섯 장을 테이블 위에 펼칠게요.' },
  pick_start: { id: 'pick_start', scene: '카드 선택 시작', text: '마음에 들어오는 카드 세 장을 차례로 골라 주세요.' },
  pick_1: { id: 'pick_1', scene: '첫째 카드 선택', text: '첫 번째 카드는 지금의 나를 비춰 줄 거예요.' },
  pick_2: { id: 'pick_2', scene: '둘째 카드 선택', text: '두 번째 카드는 다가오는 흐름을 보여 줄 거예요.' },
  pick_3: { id: 'pick_3', scene: '셋째 카드 선택', text: '마지막 카드는 나에게 필요한 행동을 알려 줄 거예요. 준비가 되면 해석 시작을 눌러 주세요.' },
  reveal: { id: 'reveal', scene: '카드 공개', text: '좋아요. 고른 카드를 뒤집어 볼게요.' },
  reading: { id: 'reading', scene: '해석 중', text: '카드의 의미를 해석 중입니다. 잠시만 기다려 주세요.' },
  reading_slow: { id: 'reading_slow', scene: '해석 지연', text: '별빛을 조금 더 모으고 있어요. 조금만 더 기다려 주세요.' },
  card_1: { id: 'card_1', scene: '첫째 카드 결과(도입)', text: '첫 번째 카드, 지금의 나예요.' },
  card_2: { id: 'card_2', scene: '둘째 카드 결과(도입)', text: '두 번째 카드, 다가오는 흐름이에요.' },
  card_3: { id: 'card_3', scene: '셋째 카드 결과(도입)', text: '세 번째 카드, 나에게 필요한 행동이에요.' },
  summary: { id: 'summary', scene: '종합 결과(도입)', text: '이제 세 장의 카드를 함께 읽어 볼게요.' },
  print: { id: 'print', scene: '인쇄 안내', text: '오늘의 이야기를 작은 기념 카드로 인쇄할 수 있어요. 용지 크기를 확인하고 인쇄 버튼을 눌러 주세요.' },
  print_closed: { id: 'print_closed', scene: '인쇄 창 닫힘', text: '인쇄 창이 닫혔어요. 카드가 나왔는지 확인해 주세요.', captionOnly: true },
  end: { id: 'end', scene: '종료', text: '함께해 줘서 고마워요. 오늘 펼친 카드가 작은 용기가 되길 바랄게요.' },
  error: { id: 'error', scene: '오류', text: '별빛이 잠시 흐려졌어요. 고른 카드는 그대로 있으니 다시 시도해 볼까요?' },
  timeout: { id: 'timeout', scene: '시간 초과', text: '해석이 조금 오래 걸리고 있어요. 다시 시도를 눌러 주세요.' },
  unconfigured: { id: 'unconfigured', scene: 'AI 연결 설정 필요', text: '지금은 카드 해석을 연결하지 못했어요. 운영자에게 알려 주세요.' },
  escape_hint: { id: 'escape_hint', scene: '긴급 복귀 안내', text: '한 번 더 누르면 처음으로 돌아갑니다', captionOnly: true },
} as const satisfies Record<string, VoiceLine>;

export type VoiceLineId = keyof typeof VOICE_LINES;

/*
 * 매번 생성되는 내용(AI 결과)을 읽는 순서
 * - 카드별: [고정 도입 card_N] → 카드 이름 + 방향 → headline(한 문장 결론) → action(작은 행동)
 * - 종합: [고정 도입 summary] → summary.title → summary.conclusion → "오늘의 작은 행동은," + summary.todayAction
 * symbolism·topicReading·combined·caution·prepare는 화면으로만 보여 주고 읽지 않습니다(체험 시간 2~4분 유지).
 */
export function cardVoiceText(card: TarotCard, reversed: boolean, reading: CardReading): string {
  return `${card.nameKo}, ${orientationLabel(reversed)}. ${reading.headline} 작은 행동으로는, ${reading.action}`;
}

export function summaryVoiceText(summary: SummaryReading): string {
  return `${summary.title}. ${summary.conclusion} 오늘의 작은 행동은, ${summary.todayAction}`;
}
