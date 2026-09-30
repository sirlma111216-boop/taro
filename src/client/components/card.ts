import cardArt from 'virtual:card-art';
import { orientationLabel } from '../../shared/cards.ts';
import type { TarotCard } from '../../shared/types.ts';
import { h } from '../dom.ts';
import { fallbackBackSvg, fallbackCardSvg } from './card-svg.ts';

/*
 * 카드 앞면·뒷면 요소
 * - 이미지가 있으면 이미지, 없으면 자체 제작 SVG를 씁니다(깨진 이미지 없음).
 * - 이미지를 불러오지 못하면(onerror) 그 자리에서 SVG로 바꿉니다.
 * - 역방향은 그림만 180도 돌리고, 번호·이름판은 바로 읽히게 둡니다.
 */

export function artUrl(id: string): string | null {
  return cardArt.art[id] ?? null;
}

export function hasArt(id: string): boolean {
  return Boolean(cardArt.art[id]);
}

export function availableArtCount(): number {
  return Object.keys(cardArt.art).length;
}

function artImage(card: TarotCard): HTMLElement {
  const url = artUrl(card.id);
  const holder = h('div', { class: 'card-art' });
  if (!url) {
    holder.appendChild(fallbackCardSvg(card));
    holder.dataset.art = 'svg';
    return holder;
  }
  const img = h('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
  img.addEventListener(
    'error',
    () => {
      img.replaceWith(fallbackCardSvg(card));
      holder.dataset.art = 'svg';
    },
    { once: true },
  );
  holder.dataset.art = 'image';
  holder.appendChild(img);
  return holder;
}

export interface CardFaceOptions {
  reversed?: boolean;
  plate?: boolean;
  className?: string;
}

/** 카드 앞면: 그림 + 번호/이름판 */
export function cardFace(card: TarotCard, options: CardFaceOptions = {}): HTMLElement {
  const { reversed = false, plate = true, className = '' } = options;
  const art = artImage(card);
  const face = h(
    'div',
    {
      class: `card-face ${reversed ? 'is-reversed' : ''} ${className}`.trim(),
      role: 'img',
      'aria-label': `${card.nameKo} 카드, ${orientationLabel(reversed)}`,
    },
    h('div', { class: 'card-art-wrap' }, art),
    plate
      ? h(
          'div',
          { class: 'card-plate', 'aria-hidden': 'true' },
          h('span', { class: 'card-plate-label' }, card.label),
          h('span', { class: 'card-plate-name' }, card.nameKo),
        )
      : null,
  );
  return face;
}

/** 카드 뒷면 */
export function cardBack(className = ''): HTMLElement {
  const holder = h('div', { class: `card-back ${className}`.trim(), 'aria-hidden': 'true' });
  if (cardArt.back) {
    const img = h('img', { src: cardArt.back, alt: '', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(fallbackBackSvg()), { once: true });
    holder.appendChild(img);
  } else {
    holder.appendChild(fallbackBackSvg());
  }
  return holder;
}

/** 이미지 미리 불러오기 (해석을 기다리는 동안 고른 카드 그림을 준비) */
export function preloadCardArt(ids: readonly string[]): void {
  for (const id of ids) {
    const url = artUrl(id);
    if (url) {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
    }
  }
}
