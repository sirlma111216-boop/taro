import { getCard, orientationLabel } from '../../shared/cards.ts';
import { positionAt } from '../../shared/spread.ts';
import { getTopic } from '../../shared/topics.ts';
import type { App, Screen } from '../app.ts';
import { summaryVoiceText } from '../audio/voice-lines.ts';
import { cardFace } from '../components/card.ts';
import { icon } from '../components/icons.ts';
import { h, paragraphs } from '../dom.ts';

export function buildSummary(app: App): Screen {
  const exp = app.experience;
  const result = exp.result!;
  const summary = result.reading.summary;
  const topic = getTopic(exp.topicId ?? '');

  const cards = h(
    'ol',
    { class: 'summary-cards', 'aria-label': '고른 세 장' },
    exp.drawn!.map((d, i) => {
      const card = getCard(d.id);
      if (!card) return null;
      return h(
        'li',
        null,
        h('button', { type: 'button', class: 'summary-card-btn', title: `${card.nameKo} 해석 다시 보기`, onclick: () => app.showCard(i) }, cardFace(card, { reversed: d.reversed })),
        h('span', { class: 'summary-card-pos' }, positionAt(i).name),
        h('span', { class: 'summary-card-name' }, `${card.nameKo} · ${orientationLabel(d.reversed)}`),
      );
    }),
  );

  const el = h(
    'div',
    { class: 'summary-screen' },
    h(
      'article',
      { class: 'summary-panel', 'aria-labelledby': 'summary-conclusion' },
      h('p', { class: 'eyebrow' }, `종합 해석 · ${topic?.name ?? ''}`),
      h('p', { class: 'summary-title' }, summary.title),
      h('h1', { id: 'summary-conclusion', class: 'summary-conclusion' }, summary.conclusion),
      h(
        'div',
        { class: 'summary-body' },
        h('section', { class: 'summary-combined' }, h('h3', null, '세 장을 함께 읽으면'), ...paragraphs(summary.combined)),
        h(
          'div',
          { class: 'summary-pair' },
          h('section', { class: 'summary-box caution' }, h('h3', null, '살펴보면 좋은 점'), ...paragraphs(summary.caution)),
          h('section', { class: 'summary-box prepare' }, h('h3', null, '준비하면 좋은 점'), ...paragraphs(summary.prepare)),
        ),
        h('section', { class: 'summary-today' }, h('h3', null, icon('sparkle'), '오늘 실천할 작은 행동'), h('p', null, summary.todayAction)),
        cards,
      ),
      result.source === 'mock' ? h('p', { class: 'mock-badge' }, '테스트용 모의 응답 — 실제 AI 해석이 아닙니다') : null,
      h('p', { class: 'summary-note' }, '카드는 미래를 정하지 않아요. 어떤 선택을 할지는 언제나 스스로 정할 수 있어요.'),
      h(
        'div',
        { class: 'summary-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-autofocus': true, onclick: () => app.openPrint() }, icon('print'), h('span', null, '기념 카드 인쇄')),
        h('button', { type: 'button', class: 'btn btn-ghost btn-lg', onclick: () => app.endExperience() }, icon('home'), h('span', null, '체험 마치기')),
      ),
    ),
  );

  return {
    name: 'summary',
    el,
    scene: 'result',
    music: 'result',
    onShown: () => {
      app.sfx('reveal');
      void app.sayDynamic('summary', summaryVoiceText(summary));
    },
  };
}
