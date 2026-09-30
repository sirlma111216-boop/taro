import { GENDER_OPTIONS } from '../../shared/topics.ts';
import type { App, Screen } from '../app.ts';
import { h } from '../dom.ts';

export function buildGender(app: App): Screen {
  const options = GENDER_OPTIONS.map((opt, i) =>
    h(
      'button',
      {
        type: 'button',
        class: `choice-card gender-${opt.id}`,
        'data-autofocus': i === 0 ? true : null,
        onclick: () => app.chooseGender(opt.id),
      },
      h('span', { class: 'choice-art', 'aria-hidden': 'true' }, h('img', { src: `assets/select/gender-${opt.id}.webp`, alt: '', decoding: 'async', draggable: 'false' })),
      h('span', { class: 'choice-label' }, opt.label),
      h('span', { class: 'choice-hint' }, opt.hint),
    ),
  );

  const el = h(
    'div',
    { class: 'center-screen' },
    h(
      'section',
      { class: 'panel choice-panel', 'aria-labelledby': 'gender-title' },
      h('p', { class: 'eyebrow' }, '첫 번째 선택'),
      h('h1', { id: 'gender-title' }, '편하게 골라 주세요'),
      h('p', { class: 'lead' }, '고른 내용은 주제를 먼저 보여 주는 순서에만 쓰여요. 운세 내용과 해석에는 쓰이지 않아요.'),
      h('div', { class: 'choice-grid choice-grid-3' }, options),
    ),
  );

  return { name: 'gender', el, scene: 'choice', music: 'select' };
}
