/*
 * 한국어 조사 붙이기
 * 이름 끝 글자의 받침 유무에 따라 이/가, 을/를, 은/는, 과/와, 아/야, (으)로 를 고릅니다.
 * - 한글: 끝 글자의 받침으로 판단 (으)로 는 ㄹ받침이면 '로'
 * - 숫자: 한국어로 읽는 소리 기준 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 → 받침 있음)
 * - 영문·기호·이모지 등 읽는 법이 확실하지 않으면 null 을 돌려주고,
 *   부르는 쪽에서 조사가 바뀌지 않는 표현(예: '의')으로 문장을 바꿉니다.
 * '의'·'에게'·'도'·'만' 은 받침과 상관없이 같으므로 이 함수가 필요 없습니다.
 */

/** 앞쪽이 받침 있을 때, 뒤쪽이 받침 없을 때 */
export type JosaPair = '이/가' | '을/를' | '은/는' | '과/와' | '아/야' | '으로/로';

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const RIEUL = 8; // 종성 인덱스 ㄹ

/** 받침 정보: { has: 받침 있음, rieul: ㄹ받침 } 또는 판단 불가 null */
export function finalSound(word: string): { has: boolean; rieul: boolean } | null {
  const trimmed = word.trim().replace(/[\s.,!?~'"’”)\]]+$/u, '');
  const last = [...trimmed].pop();
  if (!last) return null;
  const code = last.codePointAt(0) ?? 0;
  if (code >= HANGUL_START && code <= HANGUL_END) {
    const jong = (code - HANGUL_START) % 28;
    return { has: jong !== 0, rieul: jong === RIEUL };
  }
  if (/[0-9]/.test(last)) {
    return { has: '013678'.includes(last), rieul: '178'.includes(last) };
  }
  // 한글 자음 낱자(ㄱ~ㅎ)는 받침이 있는 이름(기역, 니은…)으로 읽힘. ㄹ은 리을.
  if (code >= 0x3131 && code <= 0x314e) return { has: true, rieul: last === 'ㄹ' };
  // 한글 모음 낱자(ㅏ~ㅣ)
  if (code >= 0x314f && code <= 0x3163) return { has: false, rieul: false };
  return null;
}

/** 이름 뒤에 알맞은 조사를 붙인 문자열. 판단할 수 없으면 null */
export function withJosa(word: string, pair: JosaPair): string | null {
  const sound = finalSound(word);
  if (!sound) return null;
  const [withBatchim, withoutBatchim] = pair.split('/') as [string, string];
  if (pair === '으로/로') return word + (sound.has && !sound.rieul ? '으로' : '로');
  return word + (sound.has ? withBatchim : withoutBatchim);
}

const isHangulSyllable = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  return code >= HANGUL_START && code <= HANGUL_END;
};

/** 받침으로 끝나는 한글 이름인지 (지훈, 하늘 …) → '지훈이'처럼 부르는 형태를 고를 수 있음 */
export function canAddFriendlyI(name: string): boolean {
  const chars = [...name.trim()];
  const last = chars.at(-1);
  return Boolean(last && isHangulSyllable(last) && finalSound(name)?.has);
}

/** 부르는 이름: '지훈' → '지훈이' (받침 있는 한글 이름에만) */
export function friendlyName(name: string): string {
  return canAddFriendlyI(name) ? `${name.trim()}이` : name.trim();
}

/** 두 글자 한글 이름(성 없이 부르는 이름)이면 '지훈이의'처럼 친근한 형태를 기본으로 권합니다. */
export function suggestFriendly(name: string): boolean {
  const chars = [...name.trim()];
  return canAddFriendlyI(name) && chars.length === 2 && chars.every(isHangulSyllable);
}

/**
 * 기념 카드에 쓸 이름 정리: 앞뒤 공백 제거, 연속 공백 하나로, 제어 문자 제거, 최대 10자.
 * 글자·숫자·공백과 일부 기호(· - _ ~ ♡ ★ ☆)만 남깁니다.
 */
export const MAX_NAME_LENGTH = 10;

export function cleanName(raw: string): string {
  const kept = [...raw.normalize('NFC')]
    .filter((ch) => /[\p{L}\p{N} ·\-_~♡★☆]/u.test(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return [...kept].slice(0, MAX_NAME_LENGTH).join('').trim();
}
