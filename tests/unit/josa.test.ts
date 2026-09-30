import { describe, expect, it } from 'vitest';
import { cleanName, finalSound, friendlyName, MAX_NAME_LENGTH, suggestFriendly, withJosa } from '../../src/shared/josa.ts';

describe('이름에 따른 조사', () => {
  it.each([
    ['민지', '이/가', '민지가'],
    ['지훈', '이/가', '지훈이'],
    ['하늘', '이/가', '하늘이'],
    ['민지', '아/야', '민지야'],
    ['지훈', '아/야', '지훈아'],
    ['서연', '은/는', '서연은'],
    ['유나', '은/는', '유나는'],
    ['별', '과/와', '별과'],
    ['유나', '과/와', '유나와'],
    ['소라', '을/를', '소라를'],
    ['하늘', '으로/로', '하늘로'],
    ['지훈', '으로/로', '지훈으로'],
    ['유나', '으로/로', '유나로'],
    ['별빛7', '이/가', '별빛7이'],
    ['2반', '이/가', '2반이'],
    ['팀2', '이/가', '팀2가'],
    ['ㅋㅋ', '이/가', 'ㅋㅋ이'],
  ] as const)('%s + %s → %s', (name, pair, expected) => {
    expect(withJosa(name, pair)).toBe(expected);
  });

  it('영문·이모지처럼 읽는 법이 확실하지 않으면 null (조사가 바뀌지 않는 표현을 쓰게 함)', () => {
    expect(withJosa('Luna', '이/가')).toBeNull();
    expect(withJosa('★', '이/가')).toBeNull();
    expect(finalSound('')).toBeNull();
  });

  it('끝의 문장부호·공백은 무시하고 판단', () => {
    expect(withJosa('지훈!', '이/가')).toBe('지훈!이');
    expect(finalSound('민지  ')).toEqual({ has: false, rieul: false });
  });
});

describe('부르는 이름', () => {
  it('받침 있는 한글 이름만 “이”를 붙인 부르는 이름을 만든다', () => {
    expect(friendlyName('지훈')).toBe('지훈이');
    expect(friendlyName('하늘')).toBe('하늘이');
    expect(friendlyName('민지')).toBe('민지');
    expect(friendlyName('Luna')).toBe('Luna');
    expect(friendlyName('별빛7')).toBe('별빛7');
    expect(withJosa(friendlyName('지훈'), '이/가')).toBe('지훈이가');
  });

  it('두 글자 받침 이름만 친근한 형태를 기본으로 권한다', () => {
    expect(suggestFriendly('지훈')).toBe(true);
    expect(suggestFriendly('김지훈')).toBe(false);
    expect(suggestFriendly('민지')).toBe(false);
    expect(suggestFriendly('별')).toBe(false);
  });
});

describe('이름 정리', () => {
  it('공백·제어 문자·HTML 기호를 정리하고 최대 길이로 자른다', () => {
    expect(cleanName('  지   훈  ')).toBe('지 훈');
    expect(cleanName('<b>민지</b>')).toBe('b민지b');
    expect(cleanName('별\u0000빛\u0016')).toBe('별빛');
    expect(cleanName('가나다라마바사아자차카타')).toHaveLength(MAX_NAME_LENGTH);
    expect(cleanName('루나♡')).toBe('루나♡');
    expect(cleanName('   ')).toBe('');
  });
});
