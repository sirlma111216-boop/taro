import type { Gender, Topic } from './types.ts';

/*
 * 운세 주제 12가지
 * 일반적인 타로 주제(연애·관계·학업·진로·재물·일상 운)를 중학생의 생활로 옮겼습니다.
 * aiNote는 AI 해석 때 함께 전달되는 주제별 주의 사항입니다.
 */
export const TOPICS: readonly Topic[] = [
  {
    id: 'friends',
    name: '친구와의 거리',
    question: '먼저 다가가도 괜찮을까?',
    focus: ['친해지기', '오해 풀기', '새로운 친구'],
    description: '가까워지고 싶은 친구, 조금 어색해진 친구와의 사이',
    icon: 'friends',
    aiNote: '특정 친구를 의심하거나 관계를 끊으라고 단정하지 말고, 대화와 존중 중심의 작은 행동을 제안하세요.',
  },
  {
    id: 'crush',
    name: '설렘의 시작',
    question: '이 두근거림, 어떻게 다루면 좋을까?',
    focus: ['짝사랑', '대화할 용기', '서로 존중하기'],
    description: '좋아하는 마음과 대화할 용기, 서로를 존중하는 법',
    icon: 'heart',
    aiNote: '상대의 속마음이나 연애 성사 여부·확률을 안다고 말하지 마세요. 내 마음을 돌보는 법, 부담 주지 않는 대화, 서로 존중하기에 집중하세요.',
  },
  {
    id: 'study',
    name: '공부 리듬',
    question: '나에게 맞는 공부 리듬은 뭘까?',
    focus: ['집중', '시험 준비', '나에게 맞는 공부 습관'],
    description: '집중이 잘 되는 방법과 시험 준비의 리듬',
    icon: 'book',
    aiNote: '성적이나 합격을 예언하지 말고, 오늘 해 볼 수 있는 구체적인 공부 습관을 제안하세요. 성적으로 학생의 가치를 판단하지 마세요.',
  },
  {
    id: 'talent',
    name: '나의 숨은 재능',
    question: '아직 모르는 내 재능은 어디에 있을까?',
    focus: ['창작', '발표', '새로운 도전'],
    description: '아직 발견하지 못한 나의 강점과 새로운 도전',
    icon: 'spark',
    aiNote: '특정 재능을 단정하기보다 카드 상징에서 힌트를 얻어 가볍게 시도해 볼 활동을 제안하세요.',
  },
  {
    id: 'stage',
    name: '무대와 자신감',
    question: '떨리는 무대, 어떻게 즐길 수 있을까?',
    focus: ['공연', '발표', '축제 참여'],
    description: '발표·공연·축제 무대 앞에서의 떨림과 자신감',
    icon: 'stage',
    aiNote: '실패나 성공을 예언하지 말고, 긴장을 다루는 현실적인 방법(호흡, 연습, 응원해 줄 사람 찾기)을 제안하세요.',
  },
  {
    id: 'team',
    name: '팀워크와 승부',
    question: '우리 팀이 더 단단해지려면?',
    focus: ['운동', '협동', '실수 후 회복'],
    description: '운동·모둠 활동에서의 협동과 실수 뒤의 회복',
    icon: 'team',
    aiNote: '승패를 예언하지 말고 협동, 소통, 실수 후 회복에 초점을 맞추세요. 팀원 탓을 하게 만드는 표현은 피하세요.',
  },
  {
    id: 'game',
    name: '게임과 성장',
    question: '게임 실력도, 생활 균형도 챙기려면?',
    focus: ['연습', '전략', '팀 소통', '건강한 이용 습관'],
    description: '게임 속 성장과 즐겁고 건강한 이용 습관',
    icon: 'game',
    aiNote: '게임 시간을 늘리라고 권하지 마세요. 전략·소통·연습의 즐거움과 함께 수면·휴식·시간 약속 같은 건강한 균형을 제안하세요. 과금이나 도박성 요소를 권하지 마세요.',
  },
  {
    id: 'fandom',
    name: '취향과 덕질',
    question: '좋아하는 마음을 더 즐겁게 지키려면?',
    focus: ['즐거운 팬 활동', '취미 친구', '지출 균형'],
    description: '좋아하는 것을 즐기는 법과 취미 친구, 지출의 균형',
    icon: 'star-light',
    aiNote: '아이돌이나 유명인과의 실제 관계·만남을 안다고 말하지 마세요. 과소비를 권하지 말고, 좋아하는 마음을 건강하게 즐기는 법을 제안하세요.',
  },
  {
    id: 'money',
    name: '용돈과 소비',
    question: '만족스럽게 쓰고 똑똑하게 모으려면?',
    focus: ['저축', '충동구매', '만족스러운 선택'],
    description: '용돈 관리와 충동구매, 만족스러운 소비',
    icon: 'coin',
    aiNote: '투자·코인·도박·돈 불리기를 권하지 마세요. 용돈 기록, 사기 전 하루 기다리기 같은 작은 습관을 제안하세요.',
  },
  {
    id: 'new-start',
    name: '새로운 시작',
    question: '새로운 시작 앞에서 무엇을 준비할까?',
    focus: ['동아리', '새 학기', '진로 탐색'],
    description: '동아리·새 학기·진로 탐색 같은 새 출발',
    icon: 'door',
    aiNote: '진로를 하나로 정해 주지 말고, 탐색해 볼 수 있는 작은 경험과 질문을 제안하세요.',
  },
  {
    id: 'self-expression',
    name: '나다움과 표현',
    question: '나다운 모습을 어떻게 보여 줄까?',
    focus: ['스타일', '창작물', '자신감'],
    description: '나만의 스타일과 창작, 나를 표현하는 자신감',
    icon: 'palette',
    aiNote: '외모를 평가하거나 외모로 가치를 판단하지 마세요. 취향과 표현, 자신감에 집중하세요.',
  },
  {
    id: 'daily-luck',
    name: '오늘의 작은 행운',
    question: '오늘 나에게 찾아올 작은 기회는?',
    focus: ['일상 속 좋은 기회', '작은 즐거움'],
    description: '일상에서 발견하는 작은 기회와 즐거움',
    icon: 'clover',
    aiNote: '큰 행운이나 복권 같은 것을 약속하지 말고, 오늘 알아차릴 수 있는 작은 기회와 행동을 제안하세요.',
  },
];

export const TOPIC_BY_ID: ReadonlyMap<string, Topic> = new Map(TOPICS.map((t) => [t.id, t]));

export function getTopic(id: string): Topic | undefined {
  return TOPIC_BY_ID.get(id);
}

/*
 * 성별 선택은 "처음에 먼저 보여 줄 추천 순서"에만 쓰입니다.
 * - 통계로 검증된 취향이 아니라 부스 운영자가 정한 예시 순서입니다.
 * - 세 목록 모두 친구·공부·설렘 같은 공통 주제를 포함하도록 섞었습니다.
 * - 운세 내용, AI 요청, 결과 판단에는 성별을 사용하지 않습니다.
 */
export const RECOMMENDED_TOPIC_IDS: Record<Gender, readonly string[]> = {
  girl: ['friends', 'crush', 'self-expression', 'study', 'stage', 'fandom'],
  boy: ['friends', 'team', 'study', 'game', 'crush', 'new-start'],
  none: ['daily-luck', 'friends', 'talent', 'study', 'crush', 'new-start'],
};

export const RECOMMENDED_COUNT = 6;

/** 추천 주제를 앞에, 나머지를 기본 순서대로 뒤에 붙인 전체 목록 */
export function topicsForGender(gender: Gender): { recommended: Topic[]; all: Topic[] } {
  const ids = RECOMMENDED_TOPIC_IDS[gender];
  const recommended = ids.map((id) => getTopic(id)).filter((t): t is Topic => Boolean(t));
  return { recommended, all: [...TOPICS] };
}

export const GENDER_OPTIONS: readonly { id: Gender; label: string; hint: string }[] = [
  { id: 'girl', label: '여학생', hint: '추천 주제 순서만 바뀌어요' },
  { id: 'boy', label: '남학생', hint: '추천 주제 순서만 바뀌어요' },
  { id: 'none', label: '선택하지 않을래요', hint: '모든 주제를 똑같이 볼 수 있어요' },
];
