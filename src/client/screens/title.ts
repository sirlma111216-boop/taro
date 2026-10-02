import type { App, Screen } from '../app.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';
import { formatUntil } from '../format.ts';
import { openDailyCodeDialog } from './daily-code-dialog.ts';

/**
 * 운영자용 안내 음성 선택: 이 기기 브라우저에 있는 한국어 음성 중에서 고릅니다.
 * (음성 파일을 public/audio 에 넣으면 고정 안내는 그 파일이 우선 재생됩니다)
 */
function voicePicker(app: App): HTMLElement {
  const select = h('select', { class: 'voice-select', 'aria-label': '안내 음성 선택' });
  const fill = () => {
    const voices = app.audio.koreanVoices;
    const current = app.audio.voicePreference;
    select.replaceChildren(
      h('option', { value: '' }, voices.length ? `자동 (${voices[0]?.name.replace(/^Microsoft\s+/, '') ?? ''})` : '한국어 음성 없음 · 자막만'),
      ...voices.map((v) => h('option', { value: v.name }, v.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*Korean \(Korea\)/, ''))),
    );
    select.value = current && voices.some((v) => v.name === current) ? current : '';
    select.disabled = voices.length === 0;
  };
  fill();
  // 음성 목록은 늦게 도착하는 브라우저가 있어 한 번 더 채웁니다.
  window.setTimeout(fill, 800);
  select.addEventListener('change', () => {
    app.audio.setVoicePreference(select.value || null);
    app.audio.unlock();
    void app.audio.speak('안녕하세요. 별빛서가의 안내자예요. 이 목소리로 안내할게요.');
  });
  const test = h('button', { type: 'button', class: 'chip subtle', title: '지금 음성으로 들어 보기' }, '들어 보기');
  test.addEventListener('click', () => {
    app.audio.unlock();
    void app.audio.speak('안녕하세요. 별빛서가의 안내자예요. 이 목소리로 안내할게요.');
  });
  return h('div', { class: 'voice-picker' }, h('span', { class: 'voice-picker-label' }, '안내 음성'), select, test);
}

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

  const byCode = app.session.role === 'code';
  const logoutLabel = byCode ? '로그아웃' : '운영자 로그아웃';
  let logoutArmed = false;
  let logoutTimer: number | undefined;
  const logoutBtn = h('button', { type: 'button', class: 'chip subtle', title: logoutLabel }, icon('logout'), h('span', null, logoutLabel));
  logoutBtn.addEventListener('click', () => {
    if (!logoutArmed) {
      logoutArmed = true;
      logoutBtn.querySelector('span')!.textContent = '한 번 더 누르면 로그아웃';
      logoutTimer = window.setTimeout(() => {
        logoutArmed = false;
        logoutBtn.querySelector('span')!.textContent = logoutLabel;
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
      h(
        'div',
        { class: 'title-footer-start' },
        logoutBtn,
        // 코드로 들어온 기기: 언제까지 쓸 수 있는지 작게 알려 줍니다.
        byCode && app.session.expiresAt ? h('span', { class: 'title-code-note' }, `입장 코드 · ${formatUntil(app.session.expiresAt)}까지`) : null,
      ),
      h(
        'div',
        { class: 'title-footer-end' },
        voicePicker(app),
        // 일일 코드 관리: 운영자 로그인 기기에만, 눈에 덜 띄는 작은 열쇠 아이콘으로 둡니다(열 때 비밀번호를 다시 확인).
        byCode ? null : h('button', { type: 'button', class: 'admin-key', 'aria-label': '일일 코드 관리', onclick: () => openDailyCodeDialog(app) }, icon('key')),
      ),
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
