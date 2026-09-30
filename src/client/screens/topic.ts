import { topicsForGender } from '../../shared/topics.ts';
import type { Gender, Topic } from '../../shared/types.ts';
import type { App, Screen } from '../app.ts';
import { h } from '../dom.ts';

export function buildTopic(app: App, gender: Gender): Screen {
  const { recommended, all } = topicsForGender(gender);
  let tab: 'recommended' | 'all' = 'recommended';

  const topicButton = (topic: Topic, index: number) =>
    h(
      'button',
      {
        type: 'button',
        class: 'topic-card',
        'data-topic': topic.id,
        'data-autofocus': index === 0 ? true : null,
        onclick: () => app.chooseTopic(topic.id),
      },
      h('span', { class: 'topic-art', 'aria-hidden': 'true' }, h('img', { src: `assets/select/topic-${topic.id}.webp`, alt: '', decoding: 'async', draggable: 'false' })),
      h('span', { class: 'topic-name' }, topic.name),
      h('span', { class: 'topic-question' }, topic.question),
      h('span', { class: 'topic-focus' }, topic.focus.join(' · ')),
    );

  const grid = h('div', { class: 'topic-grid', role: 'list' });
  const note = h('p', { class: 'topic-note' });
  const tabRec = h('button', { type: 'button', role: 'tab', class: 'tab', id: 'tab-rec' }, '추천 주제');
  const tabAll = h('button', { type: 'button', role: 'tab', class: 'tab', id: 'tab-all' }, `전체 주제 ${all.length}개`);

  const render = () => {
    const list = tab === 'recommended' ? recommended : all;
    grid.replaceChildren(...list.map((t, i) => h('div', { role: 'listitem' }, topicButton(t, i))));
    tabRec.setAttribute('aria-selected', String(tab === 'recommended'));
    tabAll.setAttribute('aria-selected', String(tab === 'all'));
    tabRec.classList.toggle('is-active', tab === 'recommended');
    tabAll.classList.toggle('is-active', tab === 'all');
    note.textContent =
      tab === 'recommended'
        ? '먼저 보여 주는 추천 순서예요. 다른 주제가 궁금하면 ‘전체 주제’를 눌러 보세요.'
        : '모든 학생이 모든 주제를 고를 수 있어요.';
    if (!app.motion.reduced) {
      [...grid.children].forEach((child, i) =>
        app.motion.animate(child, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 380,
          delay: 40 * i,
          easing: 'cubic-bezier(.2,.7,.2,1)',
          fill: 'backwards',
        }),
      );
    }
  };
  tabRec.addEventListener('click', () => {
    tab = 'recommended';
    render();
  });
  tabAll.addEventListener('click', () => {
    tab = 'all';
    render();
  });
  render();

  const el = h(
    'div',
    { class: 'topic-screen' },
    h(
      'section',
      { class: 'panel topic-panel', 'aria-labelledby': 'topic-title' },
      h('p', { class: 'eyebrow' }, '두 번째 선택'),
      h('h1', { id: 'topic-title' }, '오늘은 어떤 이야기가 궁금한가요?'),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': '주제 목록' }, tabRec, tabAll),
      note,
      grid,
    ),
  );

  return { name: 'topic', el, scene: 'choice', music: 'select' };
}
