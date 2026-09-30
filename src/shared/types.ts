export type Suit = 'wands' | 'cups' | 'swords' | 'pentacles';
export type Arcana = 'major' | 'minor';
export type MinorRank =
  | 'ace' | 'two' | 'three' | 'four' | 'five' | 'six' | 'seven' | 'eight' | 'nine' | 'ten'
  | 'page' | 'knight' | 'queen' | 'king';

export interface CardMeaning {
  /** 짧은 핵심어 2~4개 */
  keywords: string[];
  /** 학생에게 맞춘 한 문장 의미 */
  meaning: string;
}

export interface TarotCard {
  /** 파일명과 같은 고유 ID. 예: major-00, wands-01, cups-14 */
  id: string;
  arcana: Arcana;
  suit: Suit | null;
  /** 메이저 0~21, 마이너 1~14 (1=에이스, 11=페이지, 12=나이트, 13=퀸, 14=킹) */
  number: number;
  rank: MinorRank | null;
  nameKo: string;
  nameEn: string;
  /** 카드 위에 앱이 표시하는 번호 표기. 예: XVII, A, 7, P */
  label: string;
  /** 전통적인 그림(라이더–웨이트–스미스 계열)에서 전해지는 중심 상징 */
  symbols: string[];
  upright: CardMeaning;
  reversed: CardMeaning;
  /** 무겁게 들릴 수 있는 카드에 대한 AI 해석 지침 */
  guidance?: string;
  /** 자체 일러스트 제작용 장면 설명(이미지 프롬프트 문서 생성에 사용) */
  art: string;
}

export type Gender = 'girl' | 'boy' | 'none';

export interface Topic {
  id: string;
  name: string;
  question: string;
  /** 주제에서 다루는 구체적 내용 */
  focus: string[];
  /** 한 줄 설명 */
  description: string;
  icon: TopicIcon;
  /** AI에게 주는 주의 사항 (예: 타인의 속마음 단정 금지) */
  aiNote: string;
}

export type TopicIcon =
  | 'friends' | 'heart' | 'book' | 'spark' | 'stage' | 'team'
  | 'game' | 'star-light' | 'coin' | 'door' | 'palette' | 'clover';

export type PositionId = 'present' | 'flow' | 'action';

export interface SpreadPosition {
  id: PositionId;
  order: 1 | 2 | 3;
  name: string;
  short: string;
  description: string;
}

/** 학생이 고른 카드 한 장 (선택 순서 = 배열 순서) */
export interface DrawnCard {
  id: string;
  reversed: boolean;
}

export interface ReadingRequest {
  topicId: string;
  cards: DrawnCard[];
  /** 같은 요청의 중복 전송을 구분하기 위한 클라이언트 난수 ID */
  requestId: string;
}

export interface CardReading {
  cardId: string;
  headline: string;
  symbolism: string;
  topicReading: string;
  action: string;
}

export interface SummaryReading {
  title: string;
  conclusion: string;
  combined: string;
  caution: string;
  prepare: string;
  todayAction: string;
}

export interface PrintReading {
  headline: string;
  advice: string;
  caution: string;
  cheer: string;
  miniAdvice: string;
  miniCaution: string;
}

export interface Reading {
  cards: CardReading[];
  summary: SummaryReading;
  print: PrintReading;
}

export type ReadingSource = 'gemini' | 'mock';

export interface ReadingResponse {
  reading: Reading;
  source: ReadingSource;
  model: string;
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'duplicate_request'
  | 'ai_not_configured'
  | 'ai_timeout'
  | 'ai_blocked'
  | 'ai_bad_response'
  | 'ai_upstream_error'
  | 'not_found'
  | 'server_misconfigured';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export interface SessionInfo {
  authenticated: boolean;
  aiMode: 'gemini' | 'mock' | 'unconfigured';
  expiresAt?: number;
}
