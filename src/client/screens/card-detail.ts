import { getCard, orientationLabel, SUIT_INFO } from '../../shared/cards.ts';
import { positionAt } from '../../shared/spread.ts';
import { getTopic } from '../../shared/topics.ts';
import type { App, Screen } from '../app.ts';
import { cardVoiceText } from '../audio/voice-lines.ts';
import { cardFace } from '../components/card.ts';
import { icon } from '../components/icons.ts';
import { h, paragraphs } from '../dom.ts';

export function buildCardDetail(app: App, index: number): Screen {
  const exp = app.experience;
  const result = exp.result!;
  const drawn = exp.drawn![index]!;
  const card = getCard(drawn.id)!;
  const reading = result.reading.cards[index]!;
  const position = positionAt(index);
  const topic = getTopic(exp.topicId ?? '');
  const isLast = index === 2;

  const family = card.suit ? `${SUIT_INFO[card.suit].nameKo} · ${SUIT_INFO[card.suit].element}의 카드` : '메이저 아르카나';

  const dots = h(
    'ol',
    { class: 'progress-dots', 'aria-label': `3장 중 ${index + 1}번째 카드` },
    [0, 1, 2].map((i) => h('li', { class: i === index ? 'is-current' : i < index ? 'is-done' : '' }, h('span', { class: 'sr-only' }, `${i + 1}번째`))),
  );

  const prev = h(
    'button',
    { type: 'button', class: 'btn btn-ghost', disabled: index === 0, onclick: () => app.showCard(index - 1) },
    icon('arrow-left'),
    h('span', null, '이전 카드'),
  );
  const next = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary btn-lg',
      'data-autofocus': true,
      onclick: () => (isLast ? app.showSummary() : app.showCard(index + 1)),
    },
    h('span', null, isLast ? '종합 해석 보기' : '다음 카드'),
    icon(isLast ? 'sparkle' : 'arrow-right'),
  );

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || app.modalRoot.childElementCount) return;
    if (e.key === 'ArrowRight' && !e.repeat) {
      e.preventDefault();
      if (isLast) app.showSummary();
      else app.showCard(index + 1);
    } else if (e.key === 'ArrowLeft' && !e.repeat && index > 0) {
      e.preventDefault();
      app.showCard(index - 1);
    }
  };

  const el = h(
    'div',
    { class: 'detail-screen' },
    h(
      'section',
      { class: 'detail-card', 'aria-label': '카드 정보' },
      h('div', { class: 'detail-card-frame' }, cardFace(card, { reversed: drawn.reversed, className: 'is-large' })),
      h(
        'div',
        { class: 'detail-card-meta' },
        h('p', { class: 'detail-position' }, h('span', { class: 'badge' }, String(position.order)), position.name),
        h('h2', { class: 'detail-name' }, card.nameKo, h('small', null, card.nameEn)),
        h('p', { class: 'detail-tags' }, h('span', { class: `tag ${drawn.reversed ? 'tag-reversed' : 'tag-upright'}` }, orientationLabel(drawn.reversed)), h('span', { class: 'tag' }, family)),
      ),
    ),
    h(
      'section',
      { class: 'detail-text panel', 'aria-labelledby': 'detail-headline' },
      h('div', { class: 'detail-top' }, h('p', { class: 'eyebrow' }, `${index + 1} / 3 · ${topic?.name ?? ''}`), dots),
      h('h1', { id: 'detail-headline', class: 'detail-headline' }, reading.headline),
      h('div', { class: 'detail-section' }, h('h3', null, '카드의 상징'), ...paragraphs(reading.symbolism)),
      h('div', { class: 'detail-section' }, h('h3', null, `‘${topic?.name ?? '주제'}’에 비추어 보면`), ...paragraphs(reading.topicReading)),
      h('div', { class: 'detail-action' }, h('h3', null, icon('sparkle'), '오늘의 작은 행동'), h('p', null, reading.action)),
      result.source === 'mock' ? h('p', { class: 'mock-badge' }, '테스트용 모의 응답 — 실제 AI 해석이 아닙니다') : null,
      h('div', { class: 'detail-nav' }, prev, next),
    ),
  );

  return {
    name: 'card',
    el,
    scene: 'choice',
    music: 'result',
    onShown: () => {
      window.addEventListener('keydown', onKey);
      void app.sayDynamic(`card_${index + 1}` as 'card_1', cardVoiceText(card, drawn.reversed, reading));
    },
    dispose: () => window.removeEventListener('keydown', onKey),
  };
}
