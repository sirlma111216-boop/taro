import { getCard } from '../shared/cards.ts';
import { positionAt } from '../shared/spread.ts';
import type { DrawnCard, PrintReading } from '../shared/types.ts';
import { cardFace } from './components/card.ts';
import { h } from './dom.ts';

/*
 * 기념 카드 인쇄 — Canon SELPHY CP1300 기준
 * - Canon 공식 사양의 테두리 없는 인쇄 크기(절취선 여백을 뗀 완성 크기)에 맞췄습니다.
 *   엽서(Postcard) 100×148mm가 기본, 카드(Card) 54×86mm가 선택.
 * - 크기마다 글 분량과 배치를 따로 정했습니다(카드 사이즈는 짧은 문장만, 카드 그림 없음).
 * - SELPHY의 테두리 없는 인쇄는 가장자리가 1~2mm 잘릴 수 있어 안쪽 안전 여백을 넉넉히 둡니다.
 * - 배경은 <img>로 넣어 '배경 그래픽 인쇄'가 꺼져도 나오고, 글자는 진한 남색이라 배경이 없어도 읽힙니다.
 * - window.print()는 실제 출력 여부를 알려 주지 않으므로 성공이라고 표시하지 않습니다.
 */

export type PrintSize = 'postcard' | 'card';

export interface PrintSizeSpec {
  label: string;
  detail: string;
  /** SELPHY 인쇄 설정에서 고를 용지 이름 */
  paperName: string;
  widthMm: number;
  heightMm: number;
  background: string;
}

export const PRINT_SIZES: Record<PrintSize, PrintSizeSpec> = {
  postcard: {
    label: '엽서 사이즈 (기본)',
    detail: '100×148mm · SELPHY 엽서(Postcard) 용지',
    paperName: '엽서 / Postcard 100×148mm',
    widthMm: 100,
    heightMm: 148,
    background: 'assets/print/print-postcard.png',
  },
  card: {
    label: '카드 사이즈 (작은 카드)',
    detail: '54×86mm · SELPHY 카드(Card) 용지 · 신용카드 크기',
    paperName: '카드 / Card 54×86mm',
    widthMm: 54,
    heightMm: 86,
    background: 'assets/print/print-card.png',
  },
};

export function isPrintSize(value: unknown): value is PrintSize {
  return value === 'postcard' || value === 'card';
}

export interface PrintData {
  appName: string;
  topicName: string;
  print: PrintReading;
  cards: DrawnCard[];
  date: Date;
  isMock: boolean;
}

function dateText(date: Date): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

function cardLine(cards: DrawnCard[], compact: boolean): HTMLElement {
  return h(
    'ol',
    { class: 'pc-cardnames' },
    cards.map((drawn, i) => {
      const card = getCard(drawn.id);
      const pos = positionAt(i);
      return h(
        'li',
        null,
        compact ? `${pos.short} · ` : `${pos.name} · `,
        h('strong', null, card?.nameKo ?? drawn.id),
        ` (${drawn.reversed ? '역' : '정'})`,
      );
    }),
  );
}

export function renderPrintCard(size: PrintSize, data: PrintData): HTMLElement {
  const spec = PRINT_SIZES[size];
  const bg = h('img', { class: 'pc-bg', src: spec.background, alt: '', decoding: 'sync' });
  bg.addEventListener('error', () => bg.remove(), { once: true });

  let body: HTMLElement;
  if (size === 'postcard') {
    const thumbs = h(
      'div',
      { class: 'pc-thumbs' },
      data.cards.map((drawn, i) => {
        const card = getCard(drawn.id);
        if (!card) return null;
        return h(
          'figure',
          { class: 'pc-thumb' },
          cardFace(card, { reversed: drawn.reversed, plate: false }),
          h('figcaption', null, h('span', { class: 'pc-thumb-pos' }, positionAt(i).name), h('span', null, `${card.nameKo} · ${drawn.reversed ? '역방향' : '정방향'}`)),
        );
      }),
    );
    body = h(
      'div',
      { class: 'pc-content' },
      h('p', { class: 'pc-app' }, data.appName),
      h('p', { class: 'pc-topic' }, data.topicName),
      h('h2', { class: 'pc-headline' }, data.print.headline),
      thumbs,
      h('section', { class: 'pc-block' }, h('h3', null, '조언'), h('p', null, data.print.advice)),
      h('section', { class: 'pc-block' }, h('h3', null, '살펴볼 점'), h('p', null, data.print.caution)),
      h('p', { class: 'pc-cheer' }, data.print.cheer),
      h('p', { class: 'pc-foot' }, `${data.appName} — 너의 내일을 펼치다 · ${dateText(data.date)}`),
      data.isMock ? h('p', { class: 'pc-mock' }, '테스트용 모의 응답 · 실제 AI 해석 아님') : null,
    );
  } else {
    body = h(
      'div',
      { class: 'pc-content' },
      h('p', { class: 'pc-app' }, data.appName),
      h('p', { class: 'pc-topic' }, data.topicName),
      h('h2', { class: 'pc-headline' }, data.print.headline),
      h('p', { class: 'pc-mini' }, h('strong', null, '조언 '), data.print.miniAdvice),
      h('p', { class: 'pc-mini' }, h('strong', null, '살펴볼 점 '), data.print.miniCaution),
      cardLine(data.cards, true),
      h('p', { class: 'pc-foot' }, dateText(data.date)),
      data.isMock ? h('p', { class: 'pc-mock' }, '모의 응답') : null,
    );
  }

  return h('article', { class: `print-card pc-${size}`, 'data-size': size }, bg, h('div', { class: 'pc-safe' }, body));
}

/**
 * 글이 안전 영역을 넘치면 글자 크기를 조금씩 줄여 한 장에 들어가게 맞춥니다.
 * (서버가 문장 길이를 제한하므로 보통은 줄이지 않아도 들어갑니다)
 */
export function fitPrintCard(cardEl: HTMLElement, minScale = 0.72): number {
  const safe = cardEl.querySelector<HTMLElement>('.pc-safe');
  const content = cardEl.querySelector<HTMLElement>('.pc-content');
  if (!safe || !content) return 1;
  let scale = 1;
  cardEl.style.setProperty('--fit', '1');
  const overflowing = () => content.scrollHeight > safe.clientHeight + 0.5 || content.scrollWidth > safe.clientWidth + 0.5;
  while (overflowing() && scale > minScale) {
    scale = Math.round((scale - 0.03) * 100) / 100;
    cardEl.style.setProperty('--fit', String(scale));
  }
  cardEl.dataset.fit = String(scale);
  cardEl.dataset.overflow = overflowing() ? 'true' : 'false';
  return scale;
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
            window.setTimeout(resolve, 4000);
          }),
    ),
  );
}

function setPageSize(size: PrintSize): void {
  const spec = PRINT_SIZES[size];
  let style = document.getElementById('print-page-size') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-size';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${spec.widthMm}mm ${spec.heightMm}mm; margin: 0; }`;
}

/** 인쇄 전용 영역에 카드를 그리고 브라우저 인쇄 창을 엽니다. */
export async function printCard(size: PrintSize, data: PrintData): Promise<{ fit: number; overflow: boolean }> {
  const root = document.getElementById('print-root');
  if (!root) throw new Error('print-root가 없습니다.');
  root.replaceChildren();
  const card = renderPrintCard(size, data);
  root.appendChild(card);
  root.dataset.size = size;
  setPageSize(size);
  if ('fonts' in document) await document.fonts.ready;
  await waitForImages(root);
  const fit = fitPrintCard(card);
  const overflow = card.dataset.overflow === 'true';
  window.print();
  return { fit, overflow };
}

export function clearPrintRoot(): void {
  document.getElementById('print-root')?.replaceChildren();
}
