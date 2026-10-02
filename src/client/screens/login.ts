import type { SessionInfo } from '../../shared/types.ts';
import { api, ApiRequestError } from '../api.ts';
import type { App, Screen } from '../app.ts';
import { h } from '../dom.ts';
import { CODE_DIGITS, codeDigits, formatCode } from '../format.ts';

/*
 * 부스 입장 (학생 계정 아님)
 * - 운영자 로그인: 아이디·비밀번호
 * - 코드로 입장하기: 관리자가 만든 일일 코드(숫자 8자리, 만든 때부터 24시간)
 * 인증은 서버(/api/login, /api/login-code)가 처리하며, 이 화면은 입력만 전달합니다.
 */

type LoginMode = 'operator' | 'code';

/** 마지막으로 성공한 입장 방식을 기억해, 코드로 쓰는 기기는 다음에도 코드 칸이 먼저 보이게 합니다. */
const MODE_KEY = 'starlight.loginMode';

function savedMode(): LoginMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'code' ? 'code' : 'operator';
  } catch {
    return 'operator';
  }
}

function saveMode(mode: LoginMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* 저장하지 못해도 입장에는 문제없음 */
  }
}

function errorText(error: unknown, fallback: string): string {
  const err = error instanceof ApiRequestError ? error : null;
  if (err?.code === 'invalid_credentials') return '아이디 또는 비밀번호가 올바르지 않습니다.';
  return err?.message ?? fallback;
}

export function buildLogin(
  app: App,
  options: { modal?: boolean; onSuccess: (info: SessionInfo) => void; onCancel?: () => void },
): Screen {
  let mode: LoginMode = savedMode();
  let busy = false;

  // ------------------------------------------------------------ 운영자 로그인
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
  const form = h(
    'form',
    { class: 'login-form', novalidate: true },
    h('label', { for: 'login-username' }, '아이디'),
    username,
    h('label', { for: 'login-password' }, '비밀번호'),
    password,
    message,
    submit,
  );

  // ------------------------------------------------------------ 코드로 입장하기
  const codeInput = h('input', {
    id: 'login-code',
    name: 'code',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: 12,
    placeholder: '0000 0000',
    'aria-describedby': 'login-code-hint',
  });
  const codeMessage = h('p', { class: 'form-message', role: 'alert', 'aria-live': 'assertive' });
  const codeSubmit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '입장하기');
  const codeForm = h(
    'form',
    { class: 'login-form login-code-form', novalidate: true },
    h('label', { for: 'login-code' }, '입장 코드'),
    codeInput,
    h('p', { id: 'login-code-hint', class: 'login-code-hint' }, `관리자에게 받은 숫자 ${CODE_DIGITS}자리를 넣어 주세요.`),
    codeMessage,
    codeSubmit,
  );
  // 숫자만 남기고 네 자리마다 띄어 읽기 쉽게 보여 줍니다.
  codeInput.addEventListener('input', () => {
    const formatted = formatCode(codeInput.value);
    if (codeInput.value !== formatted) codeInput.value = formatted;
    codeMessage.textContent = '';
  });

  // ------------------------------------------------------------ 방식 전환
  const tabOperator = h('button', { type: 'button', class: 'login-mode-btn', 'data-mode': 'operator' }, '운영자 로그인');
  const tabCode = h('button', { type: 'button', class: 'login-mode-btn', 'data-mode': 'code' }, '코드로 입장하기');
  const sub = h('p', { class: 'login-sub' });

  const subText = (m: LoginMode) => {
    if (options.modal) return '로그인 시간이 끝났어요. 다시 들어오면 고른 카드로 해석을 이어 갑니다.';
    return m === 'code'
      ? '관리자가 만든 오늘의 입장 코드로 부스를 열어요.'
      : '부스를 여는 운영자 로그인입니다. 한 번 로그인하면 여러 학생이 차례로 체험할 수 있어요.';
  };

  /** 첫 입력 칸에 초점. 이미 다른 입력 칸에 적고 있으면 그대로 둡니다(빠르게 입력할 때 글자가 다른 칸으로 가지 않게). */
  const focusFirstLater = (ms: number) =>
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && (form.contains(active) || codeForm.contains(active))) return;
      (mode === 'code' ? codeInput : username).focus();
    }, ms);

  const setMode = (m: LoginMode, focus = true) => {
    mode = m;
    for (const tab of [tabOperator, tabCode]) {
      const on = tab.dataset.mode === m;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
    }
    form.hidden = m !== 'operator';
    codeForm.hidden = m !== 'code';
    sub.textContent = subText(m);
    if (focus) focusFirstLater(30);
  };
  tabOperator.addEventListener('click', () => setMode('operator'));
  tabCode.addEventListener('click', () => setMode('code'));

  // ------------------------------------------------------------ 제출
  /** 로그인 성공 뒤의 화면 전환은 로그인 오류와 따로 처리합니다(다음 화면 문제를 '로그인 실패'로 보이지 않게). */
  async function attempt(
    button: HTMLButtonElement,
    label: string,
    out: HTMLElement,
    run: () => Promise<SessionInfo>,
    onError: () => void,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = '확인 중…';
    out.textContent = '';
    let info: SessionInfo | null = null;
    try {
      info = await run();
    } catch (error) {
      out.textContent = errorText(error, '입장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      onError();
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = label;
    }
    if (info) {
      saveMode(mode);
      password.value = '';
      codeInput.value = '';
      options.onSuccess(info);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    app.audio.unlock();
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) {
      message.textContent = '아이디와 비밀번호를 입력해 주세요.';
      return;
    }
    void attempt(submit, '부스 열기', message, () => api.login(u, p), () => password.select());
  });

  codeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    app.audio.unlock();
    const code = codeDigits(codeInput.value);
    if (code.length !== CODE_DIGITS) {
      codeMessage.textContent = `입장 코드 숫자 ${CODE_DIGITS}자리를 모두 넣어 주세요.`;
      codeInput.focus();
      return;
    }
    void attempt(codeSubmit, '입장하기', codeMessage, () => api.loginWithCode(code), () => codeInput.select());
  });

  const panel = h(
    'section',
    { class: 'panel login-panel', 'aria-labelledby': 'login-title' },
    h('p', { class: 'eyebrow' }, '부스 입장'),
    h('h1', { id: 'login-title', class: 'login-title' }, options.modal ? '다시 입장하기' : '별빛서가'),
    h('div', { class: 'login-mode', role: 'group', 'aria-label': '입장 방식' }, tabOperator, tabCode),
    sub,
    form,
    codeForm,
    options.onCancel ? h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => options.onCancel?.() }, '닫기') : null,
  );
  setMode(mode, false);

  return {
    name: 'login',
    el: h('div', { class: options.modal ? 'login-modal' : 'login-screen' }, panel),
    scene: 'login',
    music: 'title',
    onShown: () => focusFirstLater(250),
  };
}
