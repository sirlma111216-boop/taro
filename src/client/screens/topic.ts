import { TOPICS } from '../../shared/topics.ts';
import type { Topic } from '../../shared/types.ts';
import type { App, Screen } from '../app.ts';
import { h } from '../dom.ts';

/** 운세 주제 12가지를 한 화면에 4개씩 3줄로 보여 줍니다. */
export function buildTopic(app: App): Screen {
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
      h('span', { class: 'topic-focus' }, topic.focus.map((f) => h('span', { class: 'topic-keyword' }, f))),
    );

  const grid = h(
    'div',
    { class: 'topic-grid', role: 'list', 'aria-label': '운세 주제 12가지' },
    TOPICS.map((t, i) => h('div', { role: 'listitem' }, topicButton(t, i))),
  );

  const el = h(
    'div',
    { class: 'topic-screen' },
    h('section', { class: 'panel topic-panel', 'aria-labelledby': 'topic-title' }, h('h1', { id: 'topic-title' }, '오늘은 어떤 이야기가 궁금한가요?'), grid),
  );

  return {
    name: 'topic',
    el,
    scene: 'choice',
    music: 'select',
    onShown: () => {
      if (app.motion.reduced) return;
      [...grid.children].forEach((child, i) =>
        app.motion.animate(child, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 380,
          delay: 35 * i,
          easing: 'cubic-bezier(.2,.7,.2,1)',
          fill: 'backwards',
        }),
      );
    },
  };
}
