import type { TableCard } from '../shared/deck.ts';
import { getTopic } from '../shared/topics.ts';
import type { DrawnCard, ReadingResponse, SessionInfo } from '../shared/types.ts';
import { api, ApiRequestError } from './api.ts';
import { AudioManager } from './audio/audio-manager.ts';
import type { MusicMood, SfxName } from './audio/synth.ts';
import { VOICE_LINES, type VoiceLineId } from './audio/voice-lines.ts';
import { icon } from './components/icons.ts';
import { h } from './dom.ts';
import { DoublePressDetector } from './escape.ts';
import { MotionRegistry } from './motion.ts';
import { clearPrintRoot } from './print.ts';
import { buildCardDetail } from './screens/card-detail.ts';
import { buildLogin } from './screens/login.ts';
import { openNameDialog } from './screens/name-dialog.ts';
import { openPrintDialog } from './screens/print-dialog.ts';
import { buildReading, type ReadingView } from './screens/reading.ts';
import { buildSummary } from './screens/summary.ts';
import { buildTable } from './screens/table.ts';
import { buildTitle } from './screens/title.ts';
import { buildTopic } from './screens/topic.ts';

export type SceneKey = 'title' | 'choice' | 'table' | 'reading' | 'result' | 'login';
export type ScreenName = 'login' | 'title' | 'topic' | 'table' | 'reading' | 'card' | 'summary';

export interface Screen {
  name: ScreenName;
  el: HTMLElement;
  scene: SceneKey;
  music: MusicMood;
  onShown?: () => void;
  dispose?: () => void;
}

const SCENE_IMAGES: Record<SceneKey, string> = {
  title: 'assets/scenes/title.webp',
  choice: 'assets/scenes/choice.webp',
  table: 'assets/scenes/table.webp',
  reading: 'assets/scenes/reading.webp',
  result: 'assets/scenes/result.webp',
  login: 'assets/scenes/choice.webp',
};

/** 한 학생의 체험 상태. 종료·긴급 복귀 때 통째로 새로 만듭니다. */
export interface Experience {
  topicId: string | null;
  table: TableCard[] | null;
  drawn: DrawnCard[] | null;
  requestId: string | null;
  result: ReadingResponse | null;
  cardIndex: number;
  /** 기념 카드에 넣을 이름(닉네임). 화면에만 쓰고 서버로 보내거나 저장하지 않음. 체험이 끝나면 비움 */
  printName: { raw: string; call: string } | null;
}

const newExperience = (): Experience => ({
  topicId: null,
  table: null,
  drawn: null,
  requestId: null,
  result: null,
  cardIndex: 0,
  printName: null,
});

export const APP_NAME = '별빛서가';

export class App {
  readonly motion = new MotionRegistry();
  readonly audio = new AudioManager();
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  readonly modalRoot: HTMLElement;

  session: SessionInfo = { authenticated: false, aiMode: 'unconfigured' };
  experience: Experience = newExperience();
  private current: Screen | null = null;
  private generation = 0;
  private readingAbort: AbortController | null = null;
  private readonly escape = new DoublePressDetector(1000);
  private readonly homeTap = new DoublePressDetector(2000);
  private captionTimer: number | undefined;
  private toastTimer: number | undefined;
  private currentScene: SceneKey | null = null;
  private readingView: ReadingView | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.stage = root.querySelector('#stage') as HTMLElement;
    this.backdrop = root.querySelector('#backdrop') as HTMLElement;
    this.topbar = root.querySelector('#topbar') as HTMLElement;
    this.captionEl = root.querySelector('#caption') as HTMLElement;
    this.toastEl = root.querySelector('#toast') as HTMLElement;
    this.modalRoot = root.querySelector('#modal-root') as HTMLElement;
  }

  /** 현재 체험 번호. 비동기 작업이 끝났을 때 이 값이 바뀌었으면 결과를 버립니다. */
  get gen(): number {
    return this.generation;
  }

  isCurrent(gen: number): boolean {
    return gen === this.generation;
  }

  get screenName(): ScreenName | null {
    return this.current?.name ?? null;
  }

  async start(): Promise<void> {
    this.bindGlobalKeys();
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.audio.onChange(() => this.renderTopbar());
    void this.audio.init();
    this.preloadScenes();

    try {
      this.session = await api.session();
    } catch {
      this.session = { authenticated: false, aiMode: 'unconfigured' };
    }
    if (this.session.authenticated) this.showTitle();
    else this.showLogin();
  }

  private preloadScenes(): void {
    for (const src of new Set(Object.values(SCENE_IMAGES))) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }

  // ---------------------------------------------------------------- 화면 전환

  private setBackdrop(scene: SceneKey): void {
    if (this.currentScene === scene) return;
    this.currentScene = scene;
    const layer = h('div', { class: `backdrop-layer scene-${scene}` }, h('img', { src: SCENE_IMAGES[scene], alt: '', decoding: 'async' }));
    this.backdrop.appendChild(layer);
    const anim = layer.animate(
      [
        { opacity: 0, transform: 'scale(1.045)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: this.motion.reduced ? 150 : 1100, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
    void anim.finished
      .catch(() => undefined)
      .then(() => {
        for (const el of [...this.backdrop.children]) if (el !== layer && el !== this.backdrop.lastElementChild) el.remove();
      });
  }

  show(next: Screen): void {
    const prev = this.current;
    this.current = next;
    this.setBackdrop(next.scene);
    this.audio.playMusic(next.music);
    this.root.dataset.screen = next.name;
    this.renderTopbar();

    next.el.classList.add('screen', `screen-${next.name}`);
    this.stage.appendChild(next.el);

    if (prev) {
      prev.dispose?.();
      prev.el.inert = true;
      prev.el.classList.add('is-leaving');
      const out = prev.el.animate(
        [
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translateY(-10px) scale(0.985)', filter: 'blur(4px)' },
        ],
        { duration: this.motion.reduced ? 120 : 420, easing: 'ease-in', fill: 'forwards' },
      );
      void out.finished.catch(() => undefined).then(() => prev.el.remove());
    }

    const enter = next.el.animate(
      [
        { opacity: 0, transform: 'translateY(14px) scale(1.01)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
      ],
      { duration: this.motion.reduced ? 150 : 650, delay: prev && !this.motion.reduced ? 180 : 0, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
    );
    void enter.finished.catch(() => undefined);

    const heading = next.el.querySelector<HTMLElement>('[data-autofocus]') ?? next.el.querySelector<HTMLElement>('h1, h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex') && !(heading instanceof HTMLButtonElement) && !(heading instanceof HTMLInputElement)) {
        heading.setAttribute('tabindex', '-1');
      }
      window.setTimeout(() => {
        // 그사이 사용자가 새 화면의 입력 칸·버튼을 눌렀으면 초점을 빼앗지 않습니다(입력이 다른 칸으로 가는 것 방지).
        if (next.el.contains(document.activeElement)) return;
        heading.focus({ preventScroll: true });
      }, this.motion.reduced ? 0 : 200);
    }
    next.onShown?.();
  }

  // ---------------------------------------------------------------- 상단 막대

  renderTopbar(): void {
    const name = this.current?.name;
    const inExperience = name !== undefined && !['login', 'title'].includes(name);
    const toggle = (label: string, on: boolean, iconName: 'music' | 'voice', onClick: () => void) =>
      h(
        'button',
        {
          type: 'button',
          class: `chip toggle ${on ? 'is-on' : ''}`,
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': `${label} ${on ? '켜짐' : '꺼짐'}`,
          title: `${label} ${on ? '끄기' : '켜기'}`,
          onclick: onClick,
        },
        icon(iconName),
        h('span', null, `${label} ${on ? '켜짐' : '꺼짐'}`),
      );

    const right = h(
      'div',
      { class: 'topbar-actions' },
      name === 'login' ? null : toggle('음악', this.audio.musicEnabled, 'music', () => this.audio.setMusicEnabled(!this.audio.musicEnabled)),
      name === 'login' ? null : toggle('음성', this.audio.voiceEnabled, 'voice', () => this.audio.setVoiceEnabled(!this.audio.voiceEnabled)),
      inExperience
        ? h(
            'button',
            { type: 'button', class: 'chip home', title: '두 번 누르면 처음 화면으로 돌아갑니다', onclick: (e: Event) => this.onHomeTap(e) },
            icon('home'),
            h('span', null, '처음으로'),
          )
        : null,
    );
    this.topbar.replaceChildren(
      h('div', { class: 'brand', 'aria-hidden': name === 'title' ? 'true' : null }, h('span', { class: 'brand-star' }, '✦'), h('span', null, APP_NAME)),
      right,
    );
  }

  private onHomeTap(event: Event): void {
    const result = this.homeTap.tap(event.timeStamp);
    if (result === 'reset') this.resetToTitle('home');
    else this.toast('한 번 더 누르면 처음으로 돌아갑니다');
  }

  // ---------------------------------------------------------------- 자막·음성·알림

  /** 고정 대본 줄을 자막으로 띄우고 음성으로 읽습니다. */
  say(id: VoiceLineId): Promise<void> {
    const line = VOICE_LINES[id];
    this.caption(line.text);
    if ('captionOnly' in line && line.captionOnly) return Promise.resolve();
    return this.audio.speak(line.text, line.id);
  }

  /**
   * AI 결과처럼 매번 달라지는 문장. 고정 도입부(파일 가능) 다음에 이어 읽습니다.
   * 읽는 내용은 이미 화면에 크게 적혀 있으므로 자막에는 짧은 도입부만 띄워 버튼을 가리지 않게 합니다.
   */
  async sayDynamic(introId: VoiceLineId, text: string): Promise<void> {
    const gen = this.gen;
    const intro = VOICE_LINES[introId];
    const token = `${intro.id}:${text.length}:${Date.now()}`;
    this.captionEl.dataset.dynamic = token;
    this.caption(intro.text);
    this.captionEl.dataset.dynamic = token;
    await this.audio.speak(intro.text, intro.id);
    if (!this.isCurrent(gen) || !this.audio.readAiResults) return;
    if (this.captionEl.dataset.dynamic !== token) return; // 다른 안내로 넘어감
    await this.audio.speak(text);
  }

  caption(text: string): void {
    window.clearTimeout(this.captionTimer);
    delete this.captionEl.dataset.dynamic;
    this.captionEl.dataset.text = text;
    this.captionEl.replaceChildren(h('span', { class: 'caption-who' }, '안내자'), h('span', { class: 'caption-text' }, text));
    this.captionEl.classList.add('is-visible');
    const ms = Math.min(16_000, 3500 + text.length * 110);
    this.captionTimer = window.setTimeout(() => this.captionEl.classList.remove('is-visible'), ms);
  }

  clearCaption(): void {
    window.clearTimeout(this.captionTimer);
    this.captionEl.classList.remove('is-visible');
    delete this.captionEl.dataset.text;
    delete this.captionEl.dataset.dynamic;
  }

  toast(text: string, ms = 1400): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-visible'), ms);
  }

  sfx(name: SfxName): void {
    this.audio.sfx(name);
  }

  // ---------------------------------------------------------------- 긴급 복귀

  private bindGlobalKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' && event.key !== 'Esc') return;
      const name = this.current?.name;
      const modalOpen = this.modalRoot.childElementCount > 0;
      if (!name || name === 'login' || name === 'title') {
        // 타이틀에서는 모달(운영자 확인 등)만 닫습니다.
        if (modalOpen && !event.repeat) this.closeModal();
        return;
      }
      const result = this.escape.press(event);
      if (result === 'first') {
        // 첫 번째 Escape: 열린 창(인쇄 미리보기 등)이 있으면 닫고, 복귀 안내를 짧게 보여 줍니다.
        if (modalOpen) this.closeModal();
        this.toast('한 번 더 누르면 처음으로 돌아갑니다', 1000);
      } else if (result === 'reset') {
        event.preventDefault();
        this.resetToTitle('escape');
      }
    });
  }

  /** 체험을 모두 비우고 타이틀로 돌아갑니다. 운영자 로그인은 유지합니다. */
  resetToTitle(reason: 'escape' | 'home' | 'end'): void {
    this.generation++;
    this.readingAbort?.abort();
    this.readingAbort = null;
    this.readingView = null;
    this.motion.cancelAll();
    this.audio.stopForReset();
    this.clearCaption();
    this.modalClose = null;
    this.modalRoot.replaceChildren();
    this.root.querySelector('#stage')?.removeAttribute('inert');
    clearPrintRoot();
    this.experience = newExperience();
    this.escape.reset();
    this.homeTap.reset();
    this.showTitle({ greet: false });
    if (reason === 'end') void this.say('end');
    else this.toast('처음 화면으로 돌아왔어요', 1400);
  }

  // ---------------------------------------------------------------- 흐름

  showLogin(): void {
    this.show(
      buildLogin(this, {
        onSuccess: (info) => {
          this.session = info;
          this.showTitle({ greet: false });
          void this.say('login_done');
        },
      }),
    );
  }

  showTitle(options: { greet?: boolean } = {}): void {
    this.show(buildTitle(this));
    if (options.greet !== false && this.audio.unlocked) void this.say('title');
  }

  async logout(): Promise<void> {
    try {
      await api.logout();
    } catch {
      /* 쿠키는 서버가 지우지만, 실패해도 화면은 로그인으로 */
    }
    this.generation++;
    this.readingAbort?.abort();
    this.motion.cancelAll();
    this.audio.stopForReset();
    this.clearCaption();
    this.experience = newExperience();
    this.session = { authenticated: false, aiMode: this.session.aiMode };
    this.showLogin();
  }

  beginExperience(): void {
    this.audio.unlock();
    this.experience = newExperience();
    this.show(buildTopic(this));
    void this.say('topic');
  }

  chooseTopic(topicId: string): void {
    if (!getTopic(topicId)) return;
    this.experience.topicId = topicId;
    this.sfx('select');
    this.show(buildTable(this));
  }

  /** 세 장이 확정되면 해석 화면으로 넘어가며 AI 요청을 시작합니다. */
  confirmCards(drawn: DrawnCard[]): void {
    this.experience.drawn = drawn;
    this.startReading();
  }

  startReading(): void {
    const exp = this.experience;
    if (!exp.drawn || !exp.topicId) return;
    const view = buildReading(this, exp.drawn, exp.topicId);
    this.readingView = view;
    this.show(view.screen);
    const gen = this.gen;
    // 해석 요청은 바로 보내고, 그동안 고른 세 장을 크게 한 장씩 뒤집어 보여 줍니다.
    void this.requestReading(true);
    void this.say('reveal');
    void view.reveal().then(() => {
      const waiting = !exp.result && !view.screen.el.classList.contains('has-error');
      if (this.isCurrent(gen) && this.readingView === view && waiting) void this.say('reading');
    });
  }

  /** 같은 카드로 다시 요청합니다(요청 ID만 새로 만듦). */
  retryReading(): void {
    this.readingView?.setWaiting();
    void this.requestReading(false);
  }

  private async requestReading(first: boolean): Promise<void> {
    const exp = this.experience;
    if (!exp.drawn || !exp.topicId) return;
    const gen = this.gen;
    this.readingAbort?.abort();
    const controller = new AbortController();
    this.readingAbort = controller;
    const requestId = crypto.randomUUID().replace(/-/g, '');
    exp.requestId = requestId;
    const view = this.readingView;
    if (!first) void this.say('reading');
    const slowTimer = this.motion.later(12_000, () => {
      if (this.isCurrent(gen) && this.readingView === view) {
        view?.setSlow();
        void this.say('reading_slow');
      }
    });

    const params = new URLSearchParams(location.search);
    const mockScenario = import.meta.env.DEV ? params.get('mock') : null;
    const devTimeout = import.meta.env.DEV ? Number(params.get('clientTimeout')) || undefined : undefined;

    try {
      const result = await api.reading(
        { topicId: exp.topicId, cards: exp.drawn, requestId },
        { signal: controller.signal, mockScenario, ...(devTimeout ? { timeoutMs: devTimeout } : {}) },
      );
      // 늦게 도착한 응답: 이미 처음으로 돌아갔거나 다른 요청이 시작됐다면 버립니다.
      if (!this.isCurrent(gen) || exp.requestId !== requestId || this.experience !== exp) return;
      this.motion.clear(slowTimer);
      exp.result = result;
      // 고른 세 장을 모두 뒤집어 보여 준 뒤, 잠시 더 볼 시간을 두고 결과로 넘어갑니다(진행률 표시는 없음).
      if (view) {
        await view.reveal();
        if (!this.isCurrent(gen) || this.experience !== exp) return;
        const hold = this.motion.reduced ? 400 : 1800;
        const since = performance.now() - (view.revealedAt ?? performance.now());
        if (since < hold) await this.motion.wait(hold - since);
      }
      if (!this.isCurrent(gen) || this.experience !== exp) return;
      this.showCard(0);
    } catch (error) {
      this.motion.clear(slowTimer);
      if (!this.isCurrent(gen) || exp.requestId !== requestId) return;
      const err = error instanceof ApiRequestError ? error : new ApiRequestError(0, 'network', '알 수 없는 오류가 발생했습니다.');
      if (err.code === 'aborted') return;
      if (err.code === 'unauthorized') this.session = { ...this.session, authenticated: false };
      view?.setError(err);
      if (err.code === 'client_timeout' || err.code === 'ai_timeout') void this.say('timeout');
      else if (err.code === 'ai_not_configured') void this.say('unconfigured');
      else void this.say('error');
    } finally {
      if (this.readingAbort === controller) this.readingAbort = null;
    }
  }

  showCard(index: number): void {
    const exp = this.experience;
    if (!exp.result || !exp.drawn || !exp.topicId) return;
    const i = Math.max(0, Math.min(2, index));
    exp.cardIndex = i;
    this.show(buildCardDetail(this, i));
  }

  showSummary(): void {
    if (!this.experience.result) return;
    this.show(buildSummary(this));
  }

  /** 기념 카드 인쇄: 먼저 이름(닉네임) 창을 띄우고, 이어서 인쇄 미리보기 창을 엽니다. */
  openPrint(): void {
    openNameDialog(this, () => openPrintDialog(this));
  }

  endExperience(): void {
    this.resetToTitle('end');
  }

  openModal(content: HTMLElement, onClose?: () => void): void {
    const backdrop = h('div', { class: 'modal-backdrop' }, content);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) this.closeModal();
    });
    this.modalClose = onClose ?? null;
    this.modalRoot.replaceChildren(backdrop);
    this.root.querySelector('#stage')?.setAttribute('inert', '');
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: this.motion.reduced ? 100 : 260 });
    content.animate(
      [
        { opacity: 0, transform: 'translateY(16px) scale(0.98)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: this.motion.reduced ? 100 : 380, easing: 'cubic-bezier(.2,.7,.2,1)' },
    );
  }

  private modalClose: (() => void) | null = null;

  closeModal(): void {
    const onClose = this.modalClose;
    this.modalClose = null;
    this.modalRoot.replaceChildren();
    this.root.querySelector('#stage')?.removeAttribute('inert');
    onClose?.();
  }

  /** 세션 만료 등으로 다시 로그인해야 할 때: 모달 로그인 후 같은 카드로 재시도 */
  reauthenticateAndRetry(): void {
    const screen = buildLogin(this, {
      modal: true,
      onSuccess: (info) => {
        this.session = info;
        this.closeModal();
        this.retryReading();
      },
      onCancel: () => this.closeModal(),
    });
    this.openModal(screen.el);
    screen.onShown?.();
  }
}
