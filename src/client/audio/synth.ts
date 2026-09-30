/*
 * Web Audio로 직접 만드는 기본 소리 (음원 파일이 없을 때 사용)
 * - 배경음악: 느린 화음 패드 + 가끔 울리는 작은 별빛 벨소리. 가사·큰 소리 없음.
 * - 효과음: 카드 놓기(촥), 선택(딩), 뒤집기(슥), 결과 등장(반짝이는 아르페지오)
 */

export type MusicMood = 'title' | 'select' | 'reading' | 'result';
export type SfxName = 'deal' | 'select' | 'flip' | 'reveal' | 'result' | 'tap';

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// D장조 계열의 부드러운 화음 (MIDI 음번호)
const PROGRESSION = [
  [50, 57, 61, 64, 66], // Dmaj9
  [47, 54, 57, 61, 62], // Bm(add9)
  [43, 50, 54, 57, 59], // Gmaj9
  [45, 52, 57, 59, 61], // A(add9)
];
const SPARKLE_NOTES = [74, 76, 78, 81, 83, 86, 88];

const MOOD: Record<MusicMood, { chordSeconds: number; filter: number; sparkleEvery: [number, number]; level: number }> = {
  title: { chordSeconds: 9, filter: 1400, sparkleEvery: [2.5, 5], level: 1 },
  select: { chordSeconds: 8, filter: 1600, sparkleEvery: [2, 4], level: 0.9 },
  reading: { chordSeconds: 11, filter: 900, sparkleEvery: [1.5, 3], level: 0.85 },
  result: { chordSeconds: 8, filter: 2000, sparkleEvery: [1.8, 3.5], level: 1 },
};

export class AmbientSynth {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly delay: DelayNode;
  private mood: MusicMood = 'title';
  private chordIndex = 0;
  private chordTimer: number | undefined;
  private sparkleTimer: number | undefined;
  private running = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1400;
    this.filter.Q.value = 0.4;
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.55;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.filter.connect(this.out);
    this.filter.connect(this.delay);
    this.delay.connect(feedback);
    feedback.connect(this.delay);
    this.delay.connect(wet);
    wet.connect(this.out);
    this.out.connect(destination);
  }

  start(mood: MusicMood): void {
    this.setMood(mood);
    if (this.running) return;
    this.running = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.16 * MOOD[this.mood].level, t + 3);
    this.playChord();
    this.scheduleSparkle();
  }

  setMood(mood: MusicMood): void {
    this.mood = mood;
    const t = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(MOOD[mood].filter, t, 1.5);
    if (this.running) this.out.gain.setTargetAtTime(0.16 * MOOD[mood].level, t, 1.2);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.clearTimeout(this.chordTimer);
    window.clearTimeout(this.sparkleTimer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 1.2);
  }

  private playChord(): void {
    if (!this.running) return;
    const chord = PROGRESSION[this.chordIndex % PROGRESSION.length] ?? PROGRESSION[0]!;
    this.chordIndex++;
    const seconds = MOOD[this.mood].chordSeconds;
    const t = this.ctx.currentTime;
    for (const note of chord) {
      for (const [type, detune] of [['sine', -5], ['triangle', 6]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToHz(note);
        osc.detune.value = detune;
        const gain = this.ctx.createGain();
        const peak = type === 'sine' ? 0.05 : 0.025;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(peak, t + 3);
        gain.gain.setValueAtTime(peak, t + seconds - 1);
        gain.gain.linearRampToValueAtTime(0, t + seconds + 3);
        osc.connect(gain).connect(this.filter);
        osc.start(t);
        osc.stop(t + seconds + 3.2);
      }
    }
    this.chordTimer = window.setTimeout(() => this.playChord(), seconds * 1000);
  }

  private scheduleSparkle(): void {
    if (!this.running) return;
    const [min, max] = MOOD[this.mood].sparkleEvery;
    const wait = (min + Math.random() * (max - min)) * 1000;
    this.sparkleTimer = window.setTimeout(() => {
      this.sparkle();
      this.scheduleSparkle();
    }, wait);
  }

  private sparkle(): void {
    if (!this.running) return;
    const note = SPARKLE_NOTES[Math.floor(Math.random() * SPARKLE_NOTES.length)] ?? 81;
    bell(this.ctx, this.delay, midiToHz(note), 0.025, 2.6);
  }
}

function bell(ctx: AudioContext, destination: AudioNode, freq: number, level: number, decay: number, when = ctx.currentTime): void {
  for (const [ratio, amp] of [[1, 1], [2.01, 0.35], [3.02, 0.12]] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level * amp, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay / ratio);
    osc.connect(g).connect(destination);
    osc.start(when);
    osc.stop(when + decay + 0.1);
  }
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** 합성 효과음. 재생 중인 소리를 멈출 수 있도록 소스 노드 목록을 돌려줍니다. */
export function playSynthSfx(ctx: AudioContext, destination: AudioNode, name: SfxName): AudioScheduledSourceNode[] {
  const t = ctx.currentTime;
  const sources: AudioScheduledSourceNode[] = [];
  const noiseBurst = (dur: number, freq: number, q: number, level: number, sweepTo?: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(destination);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
    sources.push(src);
  };
  const tone = (freq: number, dur: number, level: number, when = t, type: OscillatorType = 'sine') => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    sources.push(osc);
  };

  switch (name) {
    case 'deal': // 카드가 벨벳 위에 촥 놓이는 소리
      noiseBurst(0.11, 2600 + Math.random() * 600, 0.9, 0.5);
      tone(150, 0.07, 0.12);
      break;
    case 'select':
      tone(880, 0.7, 0.09);
      tone(1320, 0.5, 0.05, t + 0.05);
      break;
    case 'flip':
      noiseBurst(0.22, 900, 1.2, 0.28, 3200);
      break;
    case 'reveal':
      [74, 78, 81, 86].forEach((n, i) => tone(midiToHz(n), 1.2, 0.07, t + i * 0.08));
      break;
    case 'result':
      [62, 69, 74, 78, 81].forEach((n, i) => tone(midiToHz(n), 2.2, 0.05, t + i * 0.11));
      break;
    case 'tap':
      tone(1200, 0.08, 0.04);
      break;
  }
  return sources;
}
