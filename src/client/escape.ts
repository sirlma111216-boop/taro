/*
 * Escape 두 번 누르기 감지.
 * - 1초(기본) 안에 두 번 눌러야 처음으로 돌아갑니다.
 * - 키를 누르고 있을 때 생기는 반복 keydown(event.repeat)은 세지 않습니다.
 * - 브라우저 인쇄 대화상자처럼 웹 페이지 밖의 창에서 누른 키는 받을 수 없습니다.
 */

export type EscapeResult = 'first' | 'reset' | 'ignored';

export class DoublePressDetector {
  private lastPress = -Infinity;
  private readonly windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  press(event: { key: string; repeat: boolean; timeStamp: number }): EscapeResult {
    if (event.key !== 'Escape' && event.key !== 'Esc') return 'ignored';
    if (event.repeat) return 'ignored';
    const elapsed = event.timeStamp - this.lastPress;
    if (elapsed >= 0 && elapsed <= this.windowMs) {
      this.lastPress = -Infinity;
      return 'reset';
    }
    this.lastPress = event.timeStamp;
    return 'first';
  }

  /** 처음으로 버튼(터치용)도 같은 규칙: 두 번 눌러야 복귀 */
  tap(timeStamp: number): Exclude<EscapeResult, 'ignored'> {
    return this.press({ key: 'Escape', repeat: false, timeStamp }) as Exclude<EscapeResult, 'ignored'>;
  }

  reset(): void {
    this.lastPress = -Infinity;
  }
}
