import { getTopic } from '../../shared/topics.ts';
import type { App } from '../app.ts';
import { APP_NAME } from '../app.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';
import { fitPrintCard, isPrintSize, PRINT_SIZES, printCard, renderPrintCard, type PrintData, type PrintSize } from '../print.ts';

const SIZE_KEY = 'starlight.printSize';

function savedSize(): PrintSize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    if (isPrintSize(v)) return v;
  } catch {
    /* 무시 */
  }
  return 'postcard';
}

export function openPrintDialog(app: App): void {
  const exp = app.experience;
  if (!exp.result || !exp.drawn) return;
  const data: PrintData = {
    appName: APP_NAME,
    topicName: getTopic(exp.topicId ?? '')?.name ?? '',
    print: exp.result.reading.print,
    cards: exp.drawn,
    date: new Date(),
    isMock: exp.result.source === 'mock',
  };
  let size = savedSize();
  let printing = false;
  const gen = app.gen;

  const previewBox = h('div', { class: 'print-preview', 'aria-label': '인쇄 미리보기' });
  const sizeInfo = h('p', { class: 'print-size-info' });
  const status = h('p', { class: 'print-status', role: 'status', 'aria-live': 'polite' });

  const renderPreview = () => {
    const card = renderPrintCard(size, data);
    const stageEl = h('div', { class: 'print-preview-stage' }, card);
    previewBox.replaceChildren(stageEl);
    const spec = PRINT_SIZES[size];
    sizeInfo.textContent = `${spec.label} — ${spec.detail}`;
    requestAnimationFrame(() => {
      fitPrintCard(card);
      const boxW = previewBox.clientWidth - 16;
      const boxH = previewBox.clientHeight - 16;
      const scale = Math.min(boxW / card.offsetWidth, boxH / card.offsetHeight, 2.2);
      stageEl.style.width = `${card.offsetWidth * scale}px`;
      stageEl.style.height = `${card.offsetHeight * scale}px`;
      card.style.transform = `scale(${scale})`;
    });
  };

  const sizeButtons = (Object.keys(PRINT_SIZES) as PrintSize[]).map((key) => {
    const input = h('input', { type: 'radio', name: 'print-size', value: key, id: `size-${key}` });
    input.checked = key === size;
    input.addEventListener('change', () => {
      size = key;
      try {
        localStorage.setItem(SIZE_KEY, key);
      } catch {
        /* 무시 */
      }
      status.textContent = '';
      renderPreview();
    });
    return h('label', { class: 'size-option', for: `size-${key}` }, input, h('span', null, PRINT_SIZES[key].label));
  });

  const printBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-autofocus': true }, icon('print'), h('span', null, '인쇄하기'));
  printBtn.addEventListener('click', async () => {
    if (printing) return;
    printing = true;
    printBtn.disabled = true;
    status.textContent = '인쇄 창을 여는 중이에요…';
    const onAfter = () => {
      if (!app.isCurrent(gen)) return;
      // 브라우저는 실제 출력 여부를 알려 주지 않으므로 '성공'이라고 쓰지 않습니다.
      status.textContent = '인쇄 창이 닫혔어요. 종이가 나왔는지 확인해 주세요. 나오지 않았다면 프린터 설정을 확인하고 다시 인쇄를 눌러 주세요.';
      app.caption('인쇄 창이 닫혔어요. 카드가 나왔는지 확인해 주세요.');
      printing = false;
      printBtn.disabled = false;
    };
    window.addEventListener('afterprint', onAfter, { once: true });
    try {
      const { overflow } = await printCard(size, data);
      if (overflow) status.textContent = '글이 길어 일부가 작게 인쇄될 수 있어요.';
    } catch {
      status.textContent = '인쇄 창을 열지 못했어요. 브라우저 메뉴의 인쇄를 이용해 주세요.';
      printing = false;
      printBtn.disabled = false;
    }
    // afterprint 이벤트가 없는 브라우저 대비 (있으면 이벤트를 기다립니다)
    if (!('onafterprint' in globalThis)) {
      globalThis.setTimeout(() => {
        if (printing) onAfter();
      }, 1500);
    }
  });

  const help = h(
    'details',
    { class: 'print-help' },
    h('summary', null, '프린터 설정 도움말'),
    h(
      'ul',
      null,
      h('li', null, '프린터: Canon SELPHY CP1300을 고르세요.'),
      h('li', null, `용지 크기: 선택한 크기와 같은 용지(${PRINT_SIZES.postcard.paperName} 또는 ${PRINT_SIZES.card.paperName}). SELPHY에 넣은 용지·잉크 카세트도 같은 크기여야 해요.`),
      h('li', null, '테두리: 프린터 속성(기본 설정)에서 “테두리 없음”. 가장자리가 1~2mm 잘릴 수 있지만 글자는 안쪽에 있어 괜찮아요.'),
      h('li', null, '배율: 100% 또는 “실제 크기”. “페이지에 맞춤”은 끄세요.'),
      h('li', null, '여백: “없음”. 머리글·바닥글: 끄기.'),
      h('li', null, '배경 그래픽: 켜기(별빛 테두리). 꺼도 글자는 읽을 수 있어요.'),
      h('li', null, '인쇄 창에서는 Escape 두 번 복귀가 동작하지 않아요. 인쇄 창을 먼저 닫아 주세요.'),
    ),
  );

  const dialog = h(
    'section',
    { class: 'panel print-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'print-title' },
    h(
      'div',
      { class: 'print-side' },
      h('p', { class: 'eyebrow' }, '기념 카드'),
      h('h2', { id: 'print-title' }, '오늘의 카드를 인쇄해요'),
      h('fieldset', { class: 'size-options' }, h('legend', null, '용지 크기'), ...sizeButtons),
      sizeInfo,
      h('div', { class: 'print-actions' }, printBtn, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => app.closeModal() }, '닫기')),
      status,
      help,
    ),
    previewBox,
  );

  app.openModal(dialog);
  renderPreview();
  void app.say('print');
  window.setTimeout(() => printBtn.focus(), 60);
}
