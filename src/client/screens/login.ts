import type { SessionInfo } from '../../shared/types.ts';
import { api, ApiRequestError } from '../api.ts';
import type { App, Screen } from '../app.ts';
import { h } from '../dom.ts';

/*
 * 운영자 로그인 (부스를 여는 로그인, 학생 계정 아님)
 * 인증은 서버(/api/login)가 처리하며, 이 화면은 입력만 전달합니다.
 */
export function buildLogin(
  app: App,
  options: { modal?: boolean; onSuccess: (info: SessionInfo) => void; onCancel?: () => void },
): Screen {
  const username = h('input', {
    id: 'login-username',
    name: 'username',
    type: 'text',
    autocomplete: 'username',
    autocapitalize: 'off',
    spellcheck: 'false',
    required: true,
    maxlength: 64,
  });
  const password = h('input', {
    id: 'login-password',
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
    maxlength: 256,
  });
  const message = h('p', { class: 'form-message', role: 'alert', 'aria-live': 'assertive' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '부스 열기');
  let busy = false;

  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    h('label', { for: 'login-username' }, '아이디'),
    username,
    h('label', { for: 'login-password' }, '비밀번호'),
    password,
    message,
    submit,
    options.onCancel ? h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => options.onCancel?.() }, '닫기') : null,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    app.audio.unlock();
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) {
      message.textContent = '아이디와 비밀번호를 입력해 주세요.';
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = '확인 중…';
    message.textContent = '';
    let info: SessionInfo | null = null;
    try {
      info = await api.login(u, p);
    } catch (error) {
      const err = error instanceof ApiRequestError ? error : null;
      if (err?.code === 'invalid_credentials') message.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
      else if (err?.code === 'rate_limited') message.textContent = err.message;
      else if (err?.code === 'server_misconfigured') message.textContent = err.message;
      else message.textContent = err?.message ?? '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      password.select();
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = '부스 열기';
    }
    // 로그인 성공 뒤의 화면 전환은 로그인 오류와 따로 처리합니다(다음 화면 문제를 '로그인 실패'로 보이지 않게).
    if (info) {
      password.value = '';
      options.onSuccess(info);
    }
  });

  const panel = h(
    'section',
    { class: 'panel login-panel', 'aria-labelledby': 'login-title' },
    h('p', { class: 'eyebrow' }, '운영자 전용'),
    h('h1', { id: 'login-title', class: 'login-title' }, options.modal ? '운영자 다시 로그인' : '별빛서가'),
    h('p', { class: 'login-sub' }, options.modal ? '로그인 시간이 끝났어요. 다시 로그인하면 고른 카드로 해석을 이어 갑니다.' : '부스를 여는 운영자 로그인입니다. 한 번 로그인하면 여러 학생이 차례로 체험할 수 있어요.'),
    form,
  );

  return {
    name: 'login',
    el: h('div', { class: options.modal ? 'login-modal' : 'login-screen' }, panel),
    scene: 'login',
    music: 'title',
    onShown: () => window.setTimeout(() => username.focus(), 250),
  };
}
