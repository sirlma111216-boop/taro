import { canAddFriendlyI, cleanName, friendlyName, MAX_NAME_LENGTH, suggestFriendly } from '../../shared/josa.ts';
import type { App } from '../app.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';

/*
 * 기념 카드 이름(닉네임) 창
 * - 카드 맨 위에 "(이름)의 별빛서가"로 들어갑니다.
 * - 받침 있는 한글 이름은 "지훈의 / 지훈이의" 중 고를 수 있고, 이후 조사(이/가)는 고른 형태에 맞춥니다.
 * - 이름은 이 기기의 화면·인쇄에만 쓰이며 서버·AI로 보내지 않고 저장하지도 않습니다(체험이 끝나면 지움).
 */
export function openNameDialog(app: App, onDone: () => void): void {
  const exp = app.experience;
  const previous = exp.printName;
  let friendly = previous ? previous.call !== previous.raw : false;
  let touchedChoice = Boolean(previous);

  const input = h('input', {
    id: 'print-name',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    maxlength: 20,
    placeholder: '예: 민지, 지훈, 별빛',
    'aria-describedby': 'print-name-hint',
  });
  input.value = previous?.raw ?? '';

  const counter = h('span', { class: 'name-counter', 'aria-live': 'polite' });
  const choice = h('div', { class: 'name-choice', role: 'radiogroup', 'aria-label': '부르는 형태' });
  const preview = h('p', { class: 'name-preview' });
  const next = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, icon('sparkle'), h('span', null, '이 이름으로 만들기'));
  const skip = h('button', { type: 'button', class: 'btn btn-ghost' }, h('span', null, '이름 없이 인쇄'));

  const currentName = () => cleanName(input.value);

  const render = () => {
    const name = currentName();
    counter.textContent = `${[...name].length}/${MAX_NAME_LENGTH}`;
    next.disabled = name.length === 0;
    if (name && canAddFriendlyI(name)) {
      if (!touchedChoice) friendly = suggestFriendly(name);
      const option = (isFriendly: boolean) => {
        const label = `${isFriendly ? friendlyName(name) : name}의 별빛서가`;
        return h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: `name-option ${friendly === isFriendly ? 'is-on' : ''}`,
            'aria-checked': String(friendly === isFriendly),
            onclick: () => {
              friendly = isFriendly;
              touchedChoice = true;
              render();
              input.focus();
            },
          },
          label,
        );
      };
      choice.replaceChildren(h('span', { class: 'name-choice-label' }, '어떻게 부를까요?'), option(false), option(true));
      choice.hidden = false;
    } else {
      choice.replaceChildren();
      choice.hidden = true;
    }
    const call = name ? (friendly && canAddFriendlyI(name) ? friendlyName(name) : name) : '';
    preview.replaceChildren(h('span', { class: 'name-preview-star', 'aria-hidden': 'true' }, '✦'), call ? `${call}의 별빛서가` : '오늘의 별빛서가');
  };

  const finish = (withName: boolean) => {
    const name = currentName();
    exp.printName = withName && name ? { raw: name, call: friendly && canAddFriendlyI(name) ? friendlyName(name) : name } : null;
    app.closeModal();
    onDone();
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    // 한글 입력 중(조합 중) Enter는 글자 확정용이므로 제출하지 않습니다.
    if (event.key === 'Enter' && !event.isComposing && currentName()) {
      event.preventDefault();
      finish(true);
    }
  });
  next.addEventListener('click', () => finish(true));
  skip.addEventListener('click', () => finish(false));

  const dialog = h(
    'section',
    { class: 'panel name-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'name-title' },
    h('p', { class: 'eyebrow' }, '기념 카드'),
    h('h2', { id: 'name-title' }, '카드에 넣을 이름을 적어 주세요'),
    h('p', { id: 'print-name-hint', class: 'name-hint' }, '실명 대신 닉네임도 좋아요. 이름은 이 카드에만 쓰이고 저장되지 않아요.'),
    h('label', { class: 'name-field', for: 'print-name' }, h('span', { class: 'sr-only' }, '이름 또는 닉네임'), input, counter),
    choice,
    h('div', { class: 'name-preview-box' }, h('span', { class: 'name-preview-label' }, '카드 맨 위에 이렇게 들어가요'), preview),
    h('div', { class: 'name-actions' }, next, skip),
  );

  render();
  app.openModal(dialog);
  void app.say('print_name');
  window.setTimeout(() => input.focus(), 80);
}
