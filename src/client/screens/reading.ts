import { getCard, orientationLabel } from '../../shared/cards.ts';
import { positionAt } from '../../shared/spread.ts';
import { getTopic } from '../../shared/topics.ts';
import type { DrawnCard } from '../../shared/types.ts';
import type { ApiRequestError } from '../api.ts';
import type { App, Screen } from '../app.ts';
import { cardBack, cardFace } from '../components/card.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';

export interface ReadingView {
  screen: Screen;
  /** 고른 세 장을 크게 한 장씩 뒤집어 보여 줍니다. 끝나면 resolve. */
  reveal(): Promise<void>;
  /** 뒤집기가 끝난 시각(performance.now). 아직이면 null */
  readonly revealedAt: number | null;
  setWaiting(): void;
  setSlow(): void;
  setError(error: ApiRequestError): void;
}

interface ErrorCopy {
  title: string;
  body: string;
  retry: boolean;
  relogin?: boolean;
}

export function errorCopy(error: ApiRequestError): ErrorCopy {
  switch (error.code) {
    case 'client_timeout':
    case 'ai_timeout':
      return { title: '해석이 오래 걸리고 있어요', body: '응답 시간이 초과되었어요. 고른 카드는 그대로 있으니 다시 시도해 주세요.', retry: true };
    case 'ai_not_configured':
      return { title: 'AI 해석 연결 설정이 필요합니다', body: `${error.message} 설정이 끝나면 다시 시도할 수 있어요.`, retry: true };
    case 'rate_limited':
      return {
        title: '잠시 숨을 고르고 있어요',
        body: `요청이 많아 잠깐 쉬어야 해요.${error.retryAfterSeconds ? ` 약 ${error.retryAfterSeconds}초 뒤에` : ' 잠시 뒤에'} 다시 시도해 주세요.`,
        retry: true,
      };
    case 'unauthorized':
      return { title: '운영자 로그인이 끝났어요', body: '로그인 시간이 지나 해석을 요청할 수 없어요. 운영자가 다시 로그인하면 고른 카드로 이어서 해석해요.', retry: false, relogin: true };
    case 'network':
      return { title: '인터넷 연결을 확인해 주세요', body: '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.', retry: true };
    case 'ai_bad_response':
    case 'ai_blocked':
      return { title: '해석을 다시 받아 볼게요', body: 'AI 응답을 결과로 보여 줄 수 없는 형식이었어요. 같은 카드로 다시 시도해 주세요.', retry: true };
    default:
      return { title: '별빛이 잠시 흐려졌어요', body: error.message || '해석 중 문제가 생겼어요. 같은 카드로 다시 시도해 주세요.', retry: true };
  }
}

/** 카드를 한 장씩 뒤집는 간격(ms) */
const FLIP_GAP = 850;

export function buildReading(app: App, drawn: DrawnCard[], topicId: string): ReadingView {
  const topic = getTopic(topicId);
  const status = h('div', { class: 'reading-status', 'aria-live': 'polite' });
  let revealedAt: number | null = null;
  let revealPromise: Promise<void> | null = null;

  const items = drawn.map((d, i) => {
    const card = getCard(d.id);
    if (!card) return null;
    const pos = positionAt(i);
    return h(
      'li',
      { class: 'reading-card', 'aria-label': `${pos.name}: ${card.nameKo}, ${orientationLabel(d.reversed)}` },
      h('span', { class: 'reading-card-pos', 'aria-hidden': 'true' }, h('b', null, String(pos.order)), pos.name),
      h(
        'div',
        { class: 'flip-card', 'aria-hidden': 'true' },
        h('div', { class: 'flip-inner' }, h('div', { class: 'flip-face flip-back' }, cardBack()), h('div', { class: 'flip-face flip-front' }, cardFace(card, { reversed: d.reversed }))),
      ),
      h(
        'p',
        { class: 'reading-card-name', 'aria-hidden': 'true' },
        h('strong', null, card.nameKo),
        h('span', { class: `tag ${d.reversed ? 'tag-reversed' : 'tag-upright'}` }, orientationLabel(d.reversed)),
      ),
    );
  });
  const cards = h('ol', { class: 'reading-cards', 'aria-label': '고른 세 장' }, items);

  const reveal = (): Promise<void> => {
    if (revealPromise) return revealPromise;
    const gen = app.gen;
    revealPromise = new Promise((resolve) => {
      const gap = app.motion.reduced ? 120 : FLIP_GAP;
      items.forEach((item, i) => {
        app.motion.later(350 + i * gap, () => {
          if (!app.isCurrent(gen) || !item) return;
          item.classList.add('is-flipped');
          app.sfx('flip');
        });
      });
      app.motion.later(350 + (items.length - 1) * gap + (app.motion.reduced ? 150 : 850), () => {
        if (!app.isCurrent(gen)) return;
        revealedAt = performance.now();
        app.sfx('reveal');
        resolve();
      });
    });
    return revealPromise;
  };

  const setWaiting = () => {
    status.replaceChildren(
      h('h1', { class: 'reading-title', tabindex: -1 }, '카드의 의미를 해석 중입니다.'),
      h('p', { class: 'reading-sub' }, `${topic?.name ?? ''} · 고른 세 장의 상징을 이어서 읽고 있어요.`),
      h('div', { class: 'star-loader', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span'), h('span')),
    );
    el.classList.remove('has-error');
  };

  const setSlow = () => {
    if (el.classList.contains('has-error')) return;
    if (status.querySelector('.reading-slow')) return;
    status.appendChild(h('p', { class: 'reading-slow' }, '조금 더 걸리고 있어요. 조금만 더 기다려 주세요.'));
  };

  const setError = (error: ApiRequestError) => {
    const copy = errorCopy(error);
    el.classList.add('has-error');
    // 오류가 나도 고른 카드는 그대로 보여 줍니다.
    for (const item of items) item?.classList.add('is-flipped');
    const actions = h('div', { class: 'reading-actions' });
    if (copy.retry) {
      actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', 'data-autofocus': true, onclick: () => app.retryReading() }, icon('sparkle'), h('span', null, '다시 시도')));
    }
    if (copy.relogin) {
      actions.appendChild(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => app.reauthenticateAndRetry() }, h('span', null, '운영자 다시 로그인')));
    }
    actions.appendChild(h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => app.resetToTitle('home') }, icon('home'), h('span', null, '처음으로')));
    status.replaceChildren(
      h('p', { class: 'eyebrow' }, '해석을 받지 못했어요'),
      h('h1', { class: 'reading-title', tabindex: -1 }, copy.title),
      h('p', { class: 'reading-sub' }, copy.body),
      h('p', { class: 'reading-keep' }, '고른 카드와 방향은 바뀌지 않아요.'),
      actions,
    );
    const focusTarget = actions.querySelector<HTMLElement>('button');
    window.setTimeout(() => focusTarget?.focus(), 50);
  };

  const el = h(
    'div',
    { class: 'reading-screen' },
    h('section', { class: 'reading-panel' }, status, cards),
    h('div', { class: 'reading-sparkles', 'aria-hidden': 'true' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: `--i:${i};--x:${(i * 37) % 40};--xm:${(i * 37) % 90}` }))),
  );
  setWaiting();

  return {
    screen: { name: 'reading', el, scene: 'reading', music: 'reading' },
    reveal,
    get revealedAt() {
      return revealedAt;
    },
    setWaiting,
    setSlow,
    setError,
  };
}
