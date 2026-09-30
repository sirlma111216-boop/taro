import { LoopingTrack, type MusicSpec } from './music-track.ts';
import { AmbientSynth, playSynthSfx, type MusicMood, type SfxName } from './synth.ts';

/*
 * 소리 관리자
 * - 브라우저 자동재생 제한 때문에 첫 클릭/키 입력(unlock) 뒤에만 소리를 냅니다.
 * - public/audio/manifest.json 에 파일 경로가 있으면 그 음원을 쓰고, 없으면 합성음/음성합성으로 대신합니다.
 * - 장면이 바뀌어 배경음악이 달라지면 두 곡을 부드럽게 겹쳐 바꿉니다(교차 페이드).
 * - 효과음 파일은 필요한 구간만(start~duration) 잘라 재생할 수 있습니다.
 * - 음성 안내 중에는 배경음악 볼륨을 낮춥니다(더킹).
 * - 소리를 끄거나 오류가 나도 화면 흐름은 그대로 진행됩니다.
 */

/** manifest.json 의 효과음 항목 */
export interface SfxSpec {
  src: string;
  /** 파일의 몇 초 지점부터 재생할지(앞쪽 무음·잡음 건너뛰기) */
  start: number;
  /** 최대 재생 길이(초). null이면 끝까지 */
  duration: number | null;
  /** 끝을 몇 초 동안 줄이며 끝낼지 */
  fadeOut: number;
  volume: number;
}

export interface AudioManifest {
  music: Partial<Record<MusicMood, MusicSpec>>;
  sfx: Partial<Record<SfxName, SfxSpec>>;
  voice: Record<string, string | null>;
  /** AI 결과(매번 달라지는 문장)를 음성합성으로 읽을지 여부 */
  readAiResults: boolean;
}

type RawEntry = string | null | Record<string, unknown>;

const num = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function musicSpec(raw: RawEntry | undefined): MusicSpec | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return { src: raw, volume: 0.4, loopFade: 5 };
  if (typeof raw.src !== 'string' || !raw.src) return undefined;
  return { src: raw.src, volume: num(raw.volume, 0.4, 0, 1), loopFade: num(raw.loopFade, 5, 0.5, 15) };
}

function sfxSpec(raw: RawEntry | undefined): SfxSpec | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return { src: raw, start: 0, duration: null, fadeOut: 0.05, volume: 0.8 };
  if (typeof raw.src !== 'string' || !raw.src) return undefined;
  return {
    src: raw.src,
    start: num(raw.start, 0, 0, 30),
    duration: typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : null,
    fadeOut: num(raw.fadeOut, 0.05, 0, 5),
    volume: num(raw.volume, 0.8, 0, 1),
  };
}

/** manifest.json 을 읽기 쉬운 형태로 정리합니다(문자열 경로 또는 세부 설정 객체 모두 허용). */
export function normalizeManifest(data: Record<string, unknown>): AudioManifest {
  const music: AudioManifest['music'] = {};
  const sfx: AudioManifest['sfx'] = {};
  const voice: AudioManifest['voice'] = {};
  const rawMusic = (data.music ?? {}) as Record<string, RawEntry>;
  const rawSfx = (data.sfx ?? {}) as Record<string, RawEntry>;
  const rawVoice = (data.voice ?? {}) as Record<string, unknown>;
  for (const mood of ['title', 'select', 'reading', 'result'] as const) {
    const spec = musicSpec(rawMusic[mood]);
    if (spec) music[mood] = spec;
  }
  for (const name of ['deal', 'select', 'flip', 'reveal', 'result', 'tap'] as const) {
    const spec = sfxSpec(rawSfx[name]);
    if (spec) sfx[name] = spec;
  }
  for (const [key, value] of Object.entries(rawVoice)) voice[key] = typeof value === 'string' && value ? value : null;
  return { music, sfx, voice, readAiResults: data.readAiResults !== false };
}

const EMPTY_MANIFEST: AudioManifest = { music: {}, sfx: {}, voice: {}, readAiResults: true };
const STORAGE_KEY = 'starlight.sound';
const MUSIC_LEVEL = 0.8;
const DUCKED_LEVEL = 0.35;
/** 장면이 바뀔 때 배경음악을 겹쳐 바꾸는 시간(초) */
const SCENE_FADE = 1.8;

function loadPrefs(): { music: boolean; voice: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { music?: unknown; voice?: unknown };
      return { music: p.music !== false, voice: p.voice !== false };
    }
  } catch {
    /* 저장소를 못 써도 기본값으로 동작 */
  }
  return { music: true, voice: true };
}

function savePrefs(prefs: { music: boolean; voice: boolean }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 무시 */
  }
}

const VOICE_KEY = 'starlight.voice';

/** 브라우저 음성합성. 속성은 있지만 비어 있거나 기능이 없는 환경도 있으므로 실제로 쓸 수 있을 때만 돌려줍니다. */
function speech(): SpeechSynthesis | null {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return synth && typeof synth.getVoices === 'function' && typeof synth.speak === 'function' ? synth : null;
}

/**
 * 한국어 음성 우선순위: 자연스러운 신경망 음성(Edge의 "Online (Natural)" 등) > 여성 안내자에 맞는 음성 > 구글 음성.
 * Windows 기본 음성(Heami 등)은 기계음이 강해 가장 뒤로 둡니다.
 */
export function voiceScore(voice: Pick<SpeechSynthesisVoice, 'name' | 'localService'>): number {
  let score = 0;
  if (/Natural|Neural|Online|Premium|Enhanced/i.test(voice.name)) score += 100;
  if (/SunHi|JiMin|SeoHyeon|SoonBok|YuJin|Yuna|Sora|Jiyun|여성|female/i.test(voice.name)) score += 30;
  if (/Google/i.test(voice.name)) score += 20;
  if (/Heami/i.test(voice.name)) score -= 20;
  if (!voice.localService) score += 5;
  return score;
}

function loadVoicePref(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY);
  } catch {
    return null;
  }
}

export class AudioManager {
  private manifest: AudioManifest = EMPTY_MANIFEST;
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private synth: AmbientSynth | null = null;
  private readonly tracks = new Map<string, LoopingTrack>();
  private currentTrack: LoopingTrack | null = null;
  private readonly sfxBuffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private currentMood: MusicMood | null = null;
  private activeSfx = new Set<AudioScheduledSourceNode | HTMLAudioElement>();
  private voiceEl: HTMLAudioElement | null = null;
  private speechToken = 0;
  private speaking = false;
  private koVoice: SpeechSynthesisVoice | null = null;
  private prefs = loadPrefs();
  private listeners = new Set<() => void>();

  async init(): Promise<void> {
    try {
      const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = normalizeManifest((await res.json()) as Record<string, unknown>);
    } catch {
      this.manifest = EMPTY_MANIFEST;
    }
    this.pickVoice();
    const synth = speech();
    if (synth) {
      synth.addEventListener?.('voiceschanged', () => this.pickVoice());
    }
  }

  get musicEnabled(): boolean {
    return this.prefs.music;
  }

  get voiceEnabled(): boolean {
    return this.prefs.voice;
  }

  /** 한국어 음성을 낼 수 있는지 (파일 또는 음성합성) */
  get canSpeakKorean(): boolean {
    return Boolean(this.koVoice) || Object.values(this.manifest.voice).some(Boolean);
  }

  get readAiResults(): boolean {
    return this.manifest.readAiResults !== false;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 사용자 클릭·키 입력 안에서 호출해야 합니다. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        const master = this.ctx.createGain();
        master.gain.value = 1;
        master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0;
        this.musicBus.connect(master);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.9;
        this.sfxBus.connect(master);
        this.synth = new AmbientSynth(this.ctx, this.musicBus);
        this.preloadSfx();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.currentMood) this.playMusic(this.currentMood);
    } catch {
      this.ctx = null;
    }
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setMusicEnabled(on: boolean): void {
    this.prefs.music = on;
    savePrefs(this.prefs);
    this.applyMusicLevel();
    if (on && this.currentMood) this.playMusic(this.currentMood);
    if (!on) {
      // 음악을 끄면 파일 재생도 멈춰 불필요한 재생을 막습니다.
      this.currentTrack?.stop(0.4);
      this.currentTrack = null;
      this.synth?.stop();
    }
    this.emit();
  }

  setVoiceEnabled(on: boolean): void {
    this.prefs.voice = on;
    savePrefs(this.prefs);
    if (!on) this.stopVoice();
    this.emit();
  }

  private applyMusicLevel(): void {
    if (!this.ctx || !this.musicBus) return;
    const target = !this.prefs.music ? 0 : this.speaking ? DUCKED_LEVEL : MUSIC_LEVEL;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(target, t, 0.35);
  }

  /** 장면 분위기에 맞는 배경음악. 곡이 바뀌면 SCENE_FADE초 동안 겹쳐 바꿉니다. */
  playMusic(mood: MusicMood): void {
    this.currentMood = mood;
    if (!this.ctx || !this.synth || !this.musicBus) return;
    this.applyMusicLevel();
    if (!this.prefs.music) return;
    const spec = this.manifest.music[mood];
    try {
      if (spec) {
        let track = this.tracks.get(spec.src);
        if (!track) {
          track = new LoopingTrack(this.ctx, this.musicBus, spec);
          this.tracks.set(spec.src, track);
        }
        if (this.currentTrack && this.currentTrack !== track) this.currentTrack.stop(SCENE_FADE);
        this.synth.stop();
        this.currentTrack = track;
        // 같은 곡이 이미 흐르고 있으면(예: 성별→주제 화면) 끊지 않고 그대로 이어 갑니다.
        track.play(track.isPlaying ? 0.6 : SCENE_FADE);
      } else {
        this.currentTrack?.stop(SCENE_FADE);
        this.currentTrack = null;
        this.synth.start(mood);
      }
    } catch {
      /* 음악 오류는 무시하고 체험 진행 */
    }
  }

  /** 효과음 파일을 미리 내려받아 해독해 둡니다(짧은 파일이라 메모리 부담이 작음). */
  private preloadSfx(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const spec of Object.values(this.manifest.sfx)) {
      if (!spec || this.sfxBuffers.has(spec.src)) continue;
      this.sfxBuffers.set(spec.src, 'loading');
      void fetch(spec.src)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.sfxBuffers.set(spec.src, buffer))
        .catch(() => this.sfxBuffers.set(spec.src, 'failed'));
    }
  }

  sfx(name: SfxName): void {
    if (!this.prefs.music || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const spec = this.manifest.sfx[name];
    const buffer = spec ? this.sfxBuffers.get(spec.src) : undefined;
    try {
      if (spec && buffer instanceof AudioBuffer) {
        this.playBuffer(buffer, spec);
      } else {
        // 파일이 없거나 아직 준비되지 않았으면 합성 효과음으로 대신합니다.
        for (const src of playSynthSfx(this.ctx, this.sfxBus, name)) {
          this.activeSfx.add(src);
          src.addEventListener('ended', () => this.activeSfx.delete(src));
        }
      }
    } catch {
      /* 무시 */
    }
  }

  private playBuffer(buffer: AudioBuffer, spec: SfxSpec): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const start = Math.min(spec.start, Math.max(0, buffer.duration - 0.05));
    const length = Math.min(spec.duration ?? buffer.duration - start, buffer.duration - start);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const fade = Math.min(spec.fadeOut, length / 2);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(spec.volume, t + 0.005);
    gain.gain.setValueAtTime(spec.volume, t + length - fade);
    gain.gain.linearRampToValueAtTime(0, t + length);
    source.connect(gain).connect(this.sfxBus!);
    source.start(t, start, length + 0.02);
    this.activeSfx.add(source);
    source.addEventListener('ended', () => this.activeSfx.delete(source));
  }

  stopSfx(): void {
    for (const s of this.activeSfx) {
      try {
        if (s instanceof HTMLAudioElement) s.pause();
        else s.stop();
      } catch {
        /* 이미 끝남 */
      }
    }
    this.activeSfx.clear();
  }

  private voicePref: string | null = loadVoicePref();

  /** 이 기기 브라우저에서 쓸 수 있는 한국어 음성(자연스러운 순) */
  get koreanVoices(): SpeechSynthesisVoice[] {
    const synth = speech();
    if (!synth) return [];
    return synth
      .getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('ko'))
      .sort((a, b) => voiceScore(b) - voiceScore(a));
  }

  get voiceName(): string | null {
    return this.koVoice?.name ?? null;
  }

  get voicePreference(): string | null {
    return this.voicePref;
  }

  /** 운영자가 고른 음성(없으면 자동). 이 기기에만 기억합니다. */
  setVoicePreference(name: string | null): void {
    this.voicePref = name;
    try {
      if (name) localStorage.setItem(VOICE_KEY, name);
      else localStorage.removeItem(VOICE_KEY);
    } catch {
      /* 무시 */
    }
    this.pickVoice();
  }

  private pickVoice(): void {
    const voices = this.koreanVoices;
    this.koVoice = voices.find((v) => v.name === this.voicePref) ?? voices[0] ?? null;
    this.emit();
  }

  /**
   * 음성 안내. 이전 음성은 즉시 끊습니다.
   * @param fileId 고정 대본 ID (음성 파일이 있으면 파일을 재생)
   * 음성이 꺼져 있거나 한국어 음성이 없으면 아무 소리 없이 끝납니다(자막은 화면이 담당).
   */
  speak(text: string, fileId?: string): Promise<void> {
    this.stopVoice();
    const token = ++this.speechToken;
    if (!this.prefs.voice) return Promise.resolve();
    const file = fileId ? this.manifest.voice[fileId] : null;
    const done = () => {
      if (token === this.speechToken) {
        this.speaking = false;
        this.applyMusicLevel();
      }
    };

    if (file) {
      return new Promise((resolve) => {
        const el = new Audio(file);
        this.voiceEl = el;
        this.speaking = true;
        this.applyMusicLevel();
        const finish = () => {
          done();
          resolve();
        };
        el.addEventListener('ended', finish, { once: true });
        el.addEventListener('error', finish, { once: true });
        el.addEventListener('pause', finish, { once: true });
        void el.play().catch(finish);
      });
    }

    const synth = speech();
    if (!synth || !this.koVoice) return Promise.resolve();
    // 긴 문장이 끊기지 않도록 문장 단위로 나눠 읽습니다.
    const chunks = text.match(/[^.!?。]+[.!?。]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
    this.speaking = true;
    this.applyMusicLevel();
    return new Promise((resolve) => {
      const next = (i: number) => {
        if (token !== this.speechToken || i >= chunks.length) {
          done();
          resolve();
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        u.lang = 'ko-KR';
        u.voice = this.koVoice;
        u.rate = 0.97;
        // 자연스러운 신경망 음성은 높낮이를 바꾸면 오히려 어색해져 기본값을 씁니다.
        u.pitch = 1;
        u.onend = () => next(i + 1);
        u.onerror = () => {
          done();
          resolve();
        };
        synth.speak(u);
      };
      next(0);
    });
  }

  stopVoice(): void {
    this.speechToken++;
    if (this.voiceEl) {
      this.voiceEl.pause();
      this.voiceEl = null;
    }
    const synth = speech();
    if (synth) {
      try {
        synth.cancel();
      } catch {
        /* 무시 */
      }
    }
    this.speaking = false;
    this.applyMusicLevel();
  }

  /** 긴급 복귀·종료: 음성과 효과음을 멈춥니다(배경음악은 타이틀 분위기로 계속). */
  stopForReset(): void {
    this.stopVoice();
    this.stopSfx();
  }
}
