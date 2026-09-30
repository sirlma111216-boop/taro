/*
 * 배경음악 파일 반복 재생기
 * - 생성한 음악은 끝부분이 몇 초 동안 서서히 작아지므로(페이드아웃), 그대로 반복하면 소리가 꺼졌다 갑자기 다시 시작됩니다.
 *   그래서 곡이 끝나기 loopFade초 전에 같은 곡을 처음부터 하나 더 재생하며 두 소리를 겹쳐 넘깁니다(교차 페이드).
 * - <audio> 두 개를 번갈아 쓰므로 긴 곡도 메모리를 적게 씁니다.
 */

export interface MusicSpec {
  src: string;
  /** 이 곡의 기본 음량(0~1). 생성 음원은 소리가 커서 0.4 정도가 알맞음 */
  volume: number;
  /** 끝에서 몇 초 전에 다음 반복을 겹쳐 시작할지 */
  loopFade: number;
}

export class LoopingTrack {
  readonly spec: MusicSpec;
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly els: HTMLAudioElement[] = [];
  private readonly gains: GainNode[] = [];
  private active = 0;
  private timer: number | undefined;
  private stopTimer: number | undefined;
  private playing = false;

  constructor(ctx: AudioContext, destination: AudioNode, spec: MusicSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    for (let i = 0; i < 2; i++) {
      const el = new Audio(spec.src);
      el.preload = i === 0 ? 'auto' : 'metadata';
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 1 : 0;
      source.connect(gain).connect(this.out);
      this.els.push(el);
      this.gains.push(gain);
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  play(fadeIn: number): void {
    window.clearTimeout(this.stopTimer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(this.spec.volume, t + fadeIn);
    if (this.playing) return;
    this.playing = true;
    const el = this.els[this.active]!;
    this.gains[this.active]!.gain.setValueAtTime(1, t);
    void el.play().catch(() => undefined);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.checkLoop(), 200);
  }

  stop(fadeOut: number): void {
    if (!this.playing) return;
    this.playing = false;
    window.clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fadeOut);
    window.clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => {
      for (const el of this.els) el.pause();
    }, fadeOut * 1000 + 100);
  }

  private checkLoop(): void {
    const current = this.els[this.active]!;
    const duration = current.duration;
    if (!Number.isFinite(duration) || duration <= this.spec.loopFade * 2) {
      // 길이를 모르거나 너무 짧은 곡은 브라우저의 기본 반복을 씁니다.
      current.loop = true;
      return;
    }
    if (current.currentTime < duration - this.spec.loopFade) return;
    const nextIndex = 1 - this.active;
    const next = this.els[nextIndex]!;
    const t = this.ctx.currentTime;
    const fade = this.spec.loopFade * 0.9;
    next.currentTime = 0;
    void next.play().catch(() => undefined);
    const nextGain = this.gains[nextIndex]!.gain;
    const curGain = this.gains[this.active]!.gain;
    nextGain.cancelScheduledValues(t);
    nextGain.setValueAtTime(0, t);
    nextGain.linearRampToValueAtTime(1, t + fade);
    curGain.cancelScheduledValues(t);
    curGain.setValueAtTime(curGain.value, t);
    curGain.linearRampToValueAtTime(0, t + fade);
    this.active = nextIndex;
  }
}
