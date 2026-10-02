/* 일일 입장 코드·시각 표시 */

export const CODE_DIGITS = 8;

/** 입력값에서 숫자만 골라 최대 8자리로 (전각 숫자도 일반 숫자로) */
export function codeDigits(input: string): string {
  return input.normalize('NFKC').replace(/\D/g, '').slice(0, CODE_DIGITS);
}

/** "48271593" → "4827 1593" (읽고 받아 적기 쉽게 네 자리씩) */
export function formatCode(code: string): string {
  const digits = codeDigits(code);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

const untilFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

/** 예: "10월 3일 (금) 오후 2:15" (부스가 한국에 있으므로 한국 시각으로 표시) */
export function formatUntil(ms: number): string {
  return untilFormat.format(new Date(ms));
}
