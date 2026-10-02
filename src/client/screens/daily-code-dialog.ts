import type { DailyCodeAction, DailyCodeInfo } from '../../shared/types.ts';
import { api, ApiRequestError } from '../api.ts';
import type { App } from '../app.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';
import { formatCode, formatUntil } from '../format.ts';

/*
 * 일일 입장 코드 관리 (운영자 전용, 타이틀 화면 오른쪽 아래의 작은 열쇠 아이콘)
 * - 열 때마다 운영자 비밀번호를 다시 확인합니다. 부스 기기가 운영자로 로그인된 채 학생이 눌러도 코드를 볼 수 없게.
 * - 코드는 만든 때부터 24시간 동안 쓸 수 있고, 한 번에 하나만 있습니다.
 * - 확인한 비밀번호는 이 창이 열려 있는 동안만 메모리에 두고, 닫으면 지웁니다(저장하지 않음).
 */
export function openDailyCodeDialog(app: App): void {
  let password = '';
  let busy = false;
  let armTimer: number | undefined;

  const message = h('p', { class: 'form-message', role: 'alert', 'aria-live': 'assertive' });
  const body = h('div', { class: 'daily-code-body' });
  const close = () => app.closeModal();

  const fail = (error: unknown): void => {
    const err = error instanceof ApiRequestError ? error : null;
    if (err?.code === 'invalid_credentials') {
      password = '';
      showPasswordStep('비밀번호가 올바르지 않아요.');
      return;
    }
    if (err?.code === 'unauthorized') {
      message.textContent = '로그인 시간이 끝났어요. 다시 로그인한 뒤 열어 주세요.';
      return;
    }
    message.textContent = err?.message ?? '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  };

  async function run(action: DailyCodeAction, button?: HTMLButtonElement): Promise<DailyCodeInfo | null | undefined> {
    if (busy) return undefined;
    busy = true;
    if (button) button.disabled = true;
    message.textContent = '';
    try {
      return (await api.dailyCode(password, action)).code;
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  /** 1단계: 운영자 비밀번호 다시 확인 */
  function showPasswordStep(error = ''): void {
    const input = h('input', {
      id: 'daily-code-password',
      type: 'password',
      autocomplete: 'current-password',
      maxlength: 256,
    });
    const ok = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, '확인');
    const form = h(
      'form',
      { class: 'login-form', novalidate: true },
      h('label', { for: 'daily-code-password' }, '운영자 비밀번호'),
      input,
      ok,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value) {
        message.textContent = '운영자 비밀번호를 넣어 주세요.';
        return;
      }
      password = input.value;
      const code = await run('view', ok);
      if (code !== undefined) showCodeStep(code);
    });
    body.replaceChildren(h('p', { class: 'daily-code-help' }, '코드를 보거나 만들려면 운영자 비밀번호를 한 번 더 넣어 주세요.'), form);
    message.textContent = error;
    window.setTimeout(() => input.focus(), 60);
  }

  /** 두 번 눌러야 실행되는 버튼(코드 바꾸기·끄기): 실수로 다른 기기의 입장을 끊지 않도록 */
  function confirmButton(label: string, armedLabel: string, className: string, onConfirm: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const button = h('button', { type: 'button', class: className }, label);
    let armed = false;
    button.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        button.textContent = armedLabel;
        window.clearTimeout(armTimer);
        armTimer = window.setTimeout(() => {
          armed = false;
          button.textContent = label;
        }, 3500);
        return;
      }
      window.clearTimeout(armTimer);
      onConfirm(button);
    });
    return button;
  }

  /** 2단계: 지금 코드 보기 / 새로 만들기 / 끄기 */
  function showCodeStep(code: DailyCodeInfo | null): void {
    const create = async (button: HTMLButtonElement) => {
      const next = await run('create', button);
      if (next !== undefined) showCodeStep(next);
    };
    const actions = h('div', { class: 'daily-code-actions' });
    if (code) {
      const copy = h('button', { type: 'button', class: 'chip subtle daily-code-copy' }, '복사');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.code);
          copy.textContent = '복사했어요';
        } catch {
          copy.textContent = '복사할 수 없어요';
        }
      });
      body.replaceChildren(
        h(
          'div',
          { class: 'daily-code-box' },
          h('span', { class: 'daily-code-label' }, '오늘의 입장 코드'),
          h('p', { class: 'daily-code-value', 'data-code': code.code }, formatCode(code.code)),
          h('p', { class: 'daily-code-until' }, `${formatUntil(code.expiresAt)}까지 쓸 수 있어요`),
          copy,
        ),
        actions,
      );
      actions.append(
        confirmButton('새 코드로 바꾸기', '한 번 더 누르면 바꿔요', 'btn btn-primary', (b) => void create(b)),
        confirmButton('코드 끄기', '한 번 더 누르면 꺼요', 'btn btn-ghost', async (b) => {
          const next = await run('clear', b);
          if (next !== undefined) showCodeStep(next);
        }),
      );
    } else {
      body.replaceChildren(h('div', { class: 'daily-code-box is-empty' }, h('p', { class: 'daily-code-empty' }, '지금 쓸 수 있는 입장 코드가 없어요.')), actions);
      const make = h('button', { type: 'button', class: 'btn btn-primary' }, icon('sparkle'), h('span', null, '새 코드 만들기'));
      make.addEventListener('click', () => void create(make));
      actions.append(make);
    }
    body.append(
      h(
        'p',
        { class: 'daily-code-help' },
        '코드는 만든 때부터 24시간 동안 쓸 수 있어요. 코드로 들어온 기기에서는 카드 체험과 인쇄를 할 수 있지만, 코드 관리는 할 수 없어요. 새 코드로 바꾸거나 끄면 이전 코드로 들어온 기기는 다시 입장해야 해요.',
      ),
    );
  }

  const dialog = h(
    'section',
    { class: 'panel daily-code-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'daily-code-title' },
    h('p', { class: 'eyebrow' }, '운영자 전용'),
    h('h2', { id: 'daily-code-title' }, '일일 입장 코드'),
    body,
    message,
    h('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: close }, '닫기'),
  );

  showPasswordStep();
  app.openModal(dialog, () => {
    password = '';
    window.clearTimeout(armTimer);
  });
}
