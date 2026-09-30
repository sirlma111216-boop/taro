import { AmbientSynth, playSynthSfx, type MusicMood, type SfxName } from './synth.ts';

/*
 * 소리 관리자
 * - 브라우저 자동재생 제한 때문에 첫 클릭/키 입력(unlock) 뒤에만 소리를 냅니다.
 * - public/audio/manifest.json 에 파일 경로가 있으면 그 음원을 쓰고, 없으면 합성음/음성합성으로 대신합니다.
 * - 음성 안내 중에는 배경음악 볼륨을 낮춥니다(더킹).
 * - 소리를 끄거나 오류가 나도 화면 흐름은 그대로 진행됩니다.
 */

export interface AudioManifest {
  music: Partial<Record<MusicMood, string | null>>;
  sfx: Partial<Record<SfxName, string | null>>;
  voice: Record<string, string | null>;
  /** AI 결과(매번 달라지는 문장)를 음성합성으로 읽을지 여부 */
  readAiResults?: boolean;
}

const EMPTY_MANIFEST: AudioManifest = { music: {}, sfx: {}, voice: {}, readAiResults: true };
const STORAGE_KEY = 'starlight.sound';
const MUSIC_LEVEL = 0.8;
const DUCKED_LEVEL = 0.28;

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

const PREFERRED_VOICE = /(SunHi|Heami|Yuna|Seoyeon|Sora|Jiyun|여성|female|Google 한국)/i;

export class AudioManager {
  private manifest: AudioManifest = EMPTY_MANIFEST;
  private ctx: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private synth: AmbientSynth | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicElSource: MediaElementAudioSourceNode | null = null;
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
      if (res.ok) {
        const data = (await res.json()) as Partial<AudioManifest>;
        this.manifest = {
          music: data.music ?? {},
          sfx: data.sfx ?? {},
          voice: data.voice ?? {},
          readAiResults: data.readAiResults !== false,
        };
      }
    } catch {
      this.manifest = EMPTY_MANIFEST;
    }
    this.pickVoice();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice());
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

  playMusic(mood: MusicMood): void {
    this.currentMood = mood;
    if (!this.ctx || !this.synth) return;
    const file = this.manifest.music[mood];
    try {
      if (file) {
        this.synth.stop();
        if (!this.musicEl || !this.musicEl.src.endsWith(file)) {
          this.musicEl?.pause();
          const el = new Audio(file);
          el.loop = true;
          el.preload = 'auto';
          this.musicElSource?.disconnect();
          this.musicElSource = this.ctx.createMediaElementSource(el);
          this.musicElSource.connect(this.musicBus!);
          this.musicEl = el;
        }
        if (this.prefs.music) void this.musicEl.play().catch(() => undefined);
      } else {
        this.musicEl?.pause();
        if (this.prefs.music) this.synth.start(mood);
        else this.synth.setMood(mood);
      }
    } catch {
      /* 음악 오류는 무시하고 체험 진행 */
    }
    this.applyMusicLevel();
  }

  sfx(name: SfxName): void {
    if (!this.prefs.music || !this.ctx || !this.sfxBus || this.ctx.state !== 'running') return;
    const file = this.manifest.sfx[name];
    try {
      if (file) {
        const el = new Audio(file);
        el.volume = 0.8;
        this.activeSfx.add(el);
        el.addEventListener('ended', () => this.activeSfx.delete(el));
        void el.play().catch(() => this.activeSfx.delete(el));
      } else {
        for (const src of playSynthSfx(this.ctx, this.sfxBus, name)) {
          this.activeSfx.add(src);
          src.addEventListener('ended', () => this.activeSfx.delete(src));
        }
      }
    } catch {
      /* 무시 */
    }
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

  private pickVoice(): void {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ko'));
    this.koVoice = voices.find((v) => PREFERRED_VOICE.test(v.name)) ?? voices[0] ?? null;
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

    if (!('speechSynthesis' in window) || !this.koVoice) return Promise.resolve();
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
        u.rate = 0.98;
        u.pitch = 1.05;
        u.onend = () => next(i + 1);
        u.onerror = () => {
          done();
          resolve();
        };
        window.speechSynthesis.speak(u);
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
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
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
