import type { App, Screen } from '../app.ts';
import { availableArtCount } from '../components/card.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';

export function buildTitle(app: App): Screen {
  const mode = app.session.aiMode;
  const status =
    mode === 'unconfigured'
      ? h(
          'div',
          { class: 'notice notice-warn', role: 'status' },
          icon('alert'),
          h('div', null, h('strong', null, 'AI 해석 연결 설정이 필요합니다.'), h('span', null, ' 운영자는 GEMINI_API_KEY를 설정해 주세요. 설정 전에는 카드 해석을 받을 수 없습니다.')),
        )
      : mode === 'mock'
        ? h('div', { class: 'notice notice-test', role: 'status' }, icon('alert'), h('div', null, h('strong', null, '테스트 모드'), h('span', null, ' — 실제 AI가 아닌 모의 응답을 사용합니다.')))
        : null;

  let logoutArmed = false;
  let logoutTimer: number | undefined;
  const logoutBtn = h('button', { type: 'button', class: 'chip subtle', title: '운영자 로그아웃' }, icon('logout'), h('span', null, '운영자 로그아웃'));
  logoutBtn.addEventListener('click', () => {
    if (!logoutArmed) {
      logoutArmed = true;
      logoutBtn.querySelector('span')!.textContent = '한 번 더 누르면 로그아웃';
      logoutTimer = window.setTimeout(() => {
        logoutArmed = false;
        logoutBtn.querySelector('span')!.textContent = '운영자 로그아웃';
      }, 3000);
      return;
    }
    window.clearTimeout(logoutTimer);
    void app.logout();
  });

  const start = h(
    'button',
    { type: 'button', class: 'btn btn-primary btn-xl title-start', 'data-autofocus': true, onclick: () => app.beginExperience() },
    h('span', { class: 'btn-glow', 'aria-hidden': 'true' }),
    icon('sparkle'),
    h('span', null, '카드 펼치기 시작'),
  );

  const el = h(
    'div',
    { class: 'title-screen' },
    h(
      'section',
      { class: 'title-copy' },
      h('p', { class: 'eyebrow' }, '✦ 학교 축제 타로 부스 ✦'),
      h('h1', { class: 'title-logo' }, '별빛서가'),
      h('p', { class: 'title-sub' }, '너의 내일을 펼치다'),
      h('p', { class: 'title-lead' }, '세 장의 카드로 만나는 나의 가능성'),
      start,
      h('p', { class: 'title-note' }, '타로는 미래를 정해 주는 예언이 아니라, 나를 돌아보고 작은 행동을 떠올리게 돕는 놀이예요.'),
      status,
    ),
    h(
      'footer',
      { class: 'title-footer' },
      logoutBtn,
      h('span', { class: 'title-meta' }, `카드 그림 ${availableArtCount()}/78 · 나머지는 기본 제작 카드`),
    ),
  );

  return {
    name: 'title',
    el,
    scene: 'title',
    music: 'title',
    dispose: () => window.clearTimeout(logoutTimer),
  };
}
