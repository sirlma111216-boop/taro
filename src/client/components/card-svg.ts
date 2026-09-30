import { svg } from '../dom.ts';
import type { Suit, TarotCard } from '../../shared/types.ts';

/*
 * 기본 제작 카드 아트 (SVG)
 * 생성형 고해상도 카드 이미지가 아직 없는 카드에 쓰는 자체 제작 그림입니다.
 * 짙은 남색 바탕, 샴페인 골드 이중 테두리, 아치형 창, 별 점무늬를 공통으로 쓰고
 * 메이저는 카드 고유 상징, 마이너는 슈트 기호의 개수(에이스~10)와 궁정 표식으로 구분합니다.
 * 카드 번호·이름은 SVG 밖(앱의 이름판)에서 글자로 표시합니다.
 */

const GOLD = '#e2c68c';
const GOLD_DEEP = '#b8955a';
const LAVENDER = '#b9a4e8';
const IVORY = '#f6efe0';
const NAVY = '#15123a';

let uid = 0;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

type G = SVGElement;
const g = (attrs: Record<string, string | number>, ...children: G[]) => svg('g', attrs, ...children);
const path = (d: string, attrs: Record<string, string | number> = {}) => svg('path', { d, ...attrs });
const circle = (cx: number, cy: number, r: number, attrs: Record<string, string | number> = {}) => svg('circle', { cx, cy, r, ...attrs });
const stroke = (w = 0.06, color = GOLD) => ({ fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });

function starPath(points: number, outer: number, inner: number): string {
  const d: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    d.push(`${i === 0 ? 'M' : 'L'}${(Math.cos(a) * r).toFixed(3)},${(Math.sin(a) * r).toFixed(3)}`);
  }
  return d.join(' ') + 'Z';
}

// ---- 기본 도형 (단위 크기 1 기준, translate/scale로 배치) ----
const shapes = {
  star8: () => g({}, path(starPath(8, 0.5, 0.18), { fill: IVORY, stroke: GOLD, 'stroke-width': 0.03 })),
  star5: () => g({}, path(starPath(5, 0.5, 0.22), { fill: GOLD })),
  sparkle: () => g({}, path(starPath(4, 0.5, 0.12), { fill: IVORY })),
  crescent: () => path('M0.18,-0.48 A0.5,0.5 0 1 0 0.18,0.48 A0.38,0.38 0 1 1 0.18,-0.48Z', { fill: GOLD }),
  sun: () =>
    g(
      {},
      ...Array.from({ length: 12 }, (_, i) => path('M0,-0.34 L0.05,-0.5 L-0.05,-0.5Z', { fill: GOLD, transform: `rotate(${i * 30})` })),
      circle(0, 0, 0.3, { fill: GOLD, stroke: IVORY, 'stroke-width': 0.03 }),
    ),
  moon: () => g({}, circle(0, 0, 0.45, { fill: IVORY, opacity: 0.92 }), circle(0.12, -0.08, 0.08, { fill: LAVENDER, opacity: 0.5 }), circle(-0.15, 0.12, 0.06, { fill: LAVENDER, opacity: 0.5 })),
  infinity: () => path('M0,0 C0.18,-0.3 0.5,-0.3 0.5,0 C0.5,0.3 0.18,0.3 0,0 C-0.18,-0.3 -0.5,-0.3 -0.5,0 C-0.5,0.3 -0.18,0.3 0,0Z', stroke(0.07)),
  crown: () => path('M-0.45,0.25 L-0.45,-0.2 L-0.22,0.02 L0,-0.35 L0.22,0.02 L0.45,-0.2 L0.45,0.25Z', { fill: GOLD, stroke: IVORY, 'stroke-width': 0.03 }),
  queenCrown: () =>
    g({}, path('M-0.42,0.22 Q-0.46,-0.12 -0.3,-0.2 Q-0.12,0.05 0,-0.28 Q0.12,0.05 0.3,-0.2 Q0.46,-0.12 0.42,0.22Z', { fill: GOLD }), circle(0, -0.36, 0.07, { fill: IVORY })),
  scales: () =>
    g(
      stroke(0.05),
      path('M0,-0.45 L0,0.42 M-0.3,0.42 L0.3,0.42 M-0.42,-0.3 L0.42,-0.3'),
      path('M-0.42,-0.3 L-0.55,0.02 M-0.42,-0.3 L-0.29,0.02 M0.42,-0.3 L0.29,0.02 M0.42,-0.3 L0.55,0.02'),
      path('M-0.57,0.02 Q-0.42,0.2 -0.27,0.02Z M0.27,0.02 Q0.42,0.2 0.57,0.02Z', { fill: GOLD }),
    ),
  lantern: () =>
    g(
      {},
      path('M-0.2,-0.3 L0.2,-0.3 L0.26,0.3 L-0.26,0.3Z', { fill: 'rgba(246,239,224,0.18)', stroke: GOLD, 'stroke-width': 0.04 }),
      path('M-0.12,-0.3 Q0,-0.52 0.12,-0.3', stroke(0.04)),
      g({ transform: 'scale(0.36)' }, path(starPath(6, 0.5, 0.22), { fill: IVORY })),
    ),
  wheel: () =>
    g(
      stroke(0.04),
      circle(0, 0, 0.45),
      circle(0, 0, 0.3),
      circle(0, 0, 0.08, { fill: GOLD }),
      ...Array.from({ length: 8 }, (_, i) => path('M0,-0.08 L0,-0.45', { transform: `rotate(${i * 45})` })),
    ),
  tower: () =>
    g(
      {},
      path('M-0.18,0.5 L-0.14,-0.28 L0.14,-0.28 L0.18,0.5Z', { fill: '#2b2766', stroke: GOLD, 'stroke-width': 0.035 }),
      path('M-0.2,-0.28 L-0.2,-0.38 L-0.1,-0.38 L-0.1,-0.32 L0,-0.32 L0,-0.38 L0.1,-0.38 L0.1,-0.32 L0.2,-0.38 L0.2,-0.28Z', { fill: GOLD }),
      path('M0.42,-0.62 L0.12,-0.3 L0.24,-0.28 L0.02,-0.05', { fill: 'none', stroke: IVORY, 'stroke-width': 0.04 }),
      path('M-0.05,-0.1 h0.1 v0.12 h-0.1Z M-0.05,0.15 h0.1 v0.12 h-0.1Z', { fill: IVORY, opacity: 0.8 }),
    ),
  keys: () =>
    g(
      stroke(0.05),
      g({ transform: 'rotate(40)' }, circle(0, -0.36, 0.1), path('M0,-0.26 L0,0.42 M0,0.3 L0.12,0.3 M0,0.4 L0.1,0.4')),
      g({ transform: 'rotate(-40)' }, circle(0, -0.36, 0.1), path('M0,-0.26 L0,0.42 M0,0.3 L-0.12,0.3 M0,0.4 L-0.1,0.4')),
    ),
  rings: () => g(stroke(0.06), circle(-0.16, 0, 0.26), circle(0.16, 0, 0.26, { stroke: LAVENDER })),
  pillars: () =>
    g(
      {},
      path('M-0.42,-0.45 h0.16 v0.9 h-0.16Z', { fill: '#0b0a22', stroke: GOLD, 'stroke-width': 0.03 }),
      path('M0.26,-0.45 h0.16 v0.9 h-0.16Z', { fill: IVORY, stroke: GOLD, 'stroke-width': 0.03 }),
      g({ transform: 'translate(0,0.05) scale(0.55)' }, path('M0.18,-0.48 A0.5,0.5 0 1 0 0.18,0.48 A0.38,0.38 0 1 1 0.18,-0.48Z', { fill: LAVENDER })),
    ),
  wreath: () =>
    g(
      {},
      ...Array.from({ length: 16 }, (_, i) =>
        svg('ellipse', { cx: 0, cy: -0.42, rx: 0.05, ry: 0.11, fill: i % 2 ? GOLD : GOLD_DEEP, transform: `rotate(${i * 22.5})` }),
      ),
    ),
  crownStars: () =>
    g({}, ...Array.from({ length: 12 }, (_, i) => g({ transform: `rotate(${i * 30}) translate(0,-0.42) scale(0.14)` }, path(starPath(5, 0.5, 0.22), { fill: GOLD })))),
  rays: () =>
    g(
      {},
      ...Array.from({ length: 9 }, (_, i) => path('M0,0 L-0.03,-0.55 L0.03,-0.55Z', { fill: GOLD, opacity: 0.8, transform: `rotate(${-60 + i * 15})` })),
      path('M-0.35,0.12 L0.25,-0.12 L0.25,0.02 L-0.35,0.2Z', { fill: GOLD }),
      path('M0.25,-0.12 L0.4,-0.22 L0.4,0.12 L0.25,0.02Z', { fill: IVORY }),
    ),
  chain: () => g(stroke(0.06), svg('ellipse', { cx: -0.2, cy: 0, rx: 0.2, ry: 0.13 }), path('M0.05,-0.1 A0.2,0.13 0 1 1 0.05,0.1', { stroke: LAVENDER })),
  sunrise: () =>
    g(
      {},
      path('M-0.5,0.1 L0.5,0.1', stroke(0.04)),
      path('M-0.3,0.1 A0.3,0.3 0 0 1 0.3,0.1Z', { fill: GOLD, opacity: 0.9 }),
      ...Array.from({ length: 7 }, (_, i) => path('M0,-0.34 L0,-0.46', { ...stroke(0.035), transform: `translate(0,0.1) rotate(${-67.5 + i * 22.5})` })),
      g({ transform: 'translate(0,0.3) scale(0.3)' }, ...Array.from({ length: 5 }, (_, i) => svg('ellipse', { cx: 0, cy: -0.25, rx: 0.2, ry: 0.3, fill: IVORY, transform: `rotate(${i * 72})` }))),
    ),
  twoCups: () =>
    g(
      {},
      g({ transform: 'translate(-0.3,-0.12) scale(0.5) rotate(-20)' }, cupShape()),
      g({ transform: 'translate(0.3,0.18) scale(0.5) rotate(15)' }, cupShape()),
      path('M-0.18,-0.2 Q0.05,-0.05 0.22,0.05', { fill: 'none', stroke: LAVENDER, 'stroke-width': 0.05 }),
    ),
  pathStar: () =>
    g(
      {},
      path('M-0.1,0.5 Q0.3,0.25 -0.05,0.05 Q-0.35,-0.12 0.1,-0.28', { fill: 'none', stroke: LAVENDER, 'stroke-width': 0.08, 'stroke-linecap': 'round' }),
      g({ transform: 'translate(0.18,-0.42) scale(0.3)' }, path(starPath(8, 0.5, 0.18), { fill: IVORY })),
      circle(-0.25, 0.3, 0.06, { fill: IVORY }),
    ),
  chariot: () =>
    g(
      {},
      path('M-0.4,-0.1 L0.4,-0.1 L0.3,0.2 L-0.3,0.2Z', { fill: '#2b2766', stroke: GOLD, 'stroke-width': 0.035 }),
      path('M-0.42,-0.1 Q0,-0.45 0.42,-0.1', stroke(0.04)),
      circle(-0.25, 0.3, 0.12, stroke(0.04)),
      circle(0.25, 0.3, 0.12, stroke(0.04)),
      g({ transform: 'translate(0,-0.22) scale(0.16)' }, path(starPath(5, 0.5, 0.22), { fill: IVORY })),
    ),
  lion: () =>
    g(
      {},
      ...Array.from({ length: 14 }, (_, i) => svg('ellipse', { cx: 0, cy: -0.3, rx: 0.07, ry: 0.14, fill: GOLD_DEEP, transform: `rotate(${i * 25.7})` })),
      circle(0, 0, 0.24, { fill: GOLD }),
      g({ transform: 'translate(0,-0.5) scale(0.4)' }, path('M0,0 C0.18,-0.3 0.5,-0.3 0.5,0 C0.5,0.3 0.18,0.3 0,0 C-0.18,-0.3 -0.5,-0.3 -0.5,0 C-0.5,0.3 -0.18,0.3 0,0Z', stroke(0.12, IVORY))),
    ),
  hanging: () =>
    g(
      {},
      path('M-0.4,-0.42 L0.4,-0.42 M0,-0.42 L0,-0.2', stroke(0.05)),
      g({ transform: 'translate(0,0.1) rotate(180) scale(0.6)' }, path('M-0.2,-0.3 L0.2,-0.3 L0.26,0.3 L-0.26,0.3Z', { fill: 'rgba(246,239,224,0.2)', stroke: GOLD, 'stroke-width': 0.05 })),
      circle(0, 0.1, 0.34, { fill: 'none', stroke: IVORY, 'stroke-width': 0.02, opacity: 0.7 }),
    ),
} satisfies Record<string, () => G>;

type ShapeName = keyof typeof shapes;

function cupShape(): G {
  return g(
    { fill: GOLD, stroke: IVORY, 'stroke-width': 0.035 },
    path('M-0.42,-0.5 L0.42,-0.5 Q0.42,0.05 0,0.12 Q-0.42,0.05 -0.42,-0.5Z'),
    path('M-0.06,0.1 h0.12 v0.26 h-0.12Z'),
    svg('ellipse', { cx: 0, cy: 0.42, rx: 0.26, ry: 0.07 }),
  );
}

function suitShape(suit: Suit): G {
  switch (suit) {
    case 'cups':
      return cupShape();
    case 'wands':
      return g(
        {},
        path('M0,-0.58 L0,0.58', { fill: 'none', stroke: '#c79a5b', 'stroke-width': 0.1, 'stroke-linecap': 'round' }),
        svg('ellipse', { cx: 0.12, cy: -0.34, rx: 0.1, ry: 0.05, fill: '#8fc7a0', transform: 'rotate(-30 0.12 -0.34)' }),
        svg('ellipse', { cx: -0.12, cy: -0.12, rx: 0.1, ry: 0.05, fill: '#8fc7a0', transform: 'rotate(30 -0.12 -0.12)' }),
        svg('ellipse', { cx: 0.12, cy: 0.14, rx: 0.09, ry: 0.045, fill: '#8fc7a0', transform: 'rotate(-30 0.12 0.14)' }),
        g({ transform: 'translate(0,-0.62) scale(0.16)' }, path(starPath(4, 0.5, 0.15), { fill: IVORY })),
      );
    case 'swords':
      return g(
        {},
        path('M0,-0.62 L0.07,-0.46 L0.07,0.24 L-0.07,0.24 L-0.07,-0.46Z', { fill: '#dfe3f0', stroke: GOLD, 'stroke-width': 0.025 }),
        path('M-0.26,0.24 h0.52 v0.07 h-0.52Z', { fill: GOLD }),
        path('M-0.04,0.31 h0.08 v0.2 h-0.08Z', { fill: GOLD_DEEP }),
        circle(0, 0.56, 0.06, { fill: GOLD }),
      );
    case 'pentacles':
      return g(
        {},
        circle(0, 0, 0.46, { fill: GOLD_DEEP, stroke: GOLD, 'stroke-width': 0.05 }),
        circle(0, 0, 0.36, { fill: 'none', stroke: IVORY, 'stroke-width': 0.02, opacity: 0.7 }),
        path(starPath(5, 0.32, 0.13), { fill: 'none', stroke: IVORY, 'stroke-width': 0.04, 'stroke-linejoin': 'round' }),
      );
  }
}

const MAJOR_EMBLEM: ShapeName[] = [
  'pathStar', 'infinity', 'pillars', 'crownStars', 'crown', 'keys', 'rings', 'chariot', 'lion', 'lantern', 'wheel',
  'scales', 'hanging', 'sunrise', 'twoCups', 'chain', 'tower', 'star8', 'moon', 'sun', 'rays', 'wreath',
];

// 에이스~10의 기호 배치 (0~1 좌표)
const PIPS: [number, number][][] = [
  [[0.5, 0.5]],
  [[0.5, 0.25], [0.5, 0.75]],
  [[0.5, 0.18], [0.5, 0.5], [0.5, 0.82]],
  [[0.3, 0.25], [0.7, 0.25], [0.3, 0.75], [0.7, 0.75]],
  [[0.3, 0.22], [0.7, 0.22], [0.5, 0.5], [0.3, 0.78], [0.7, 0.78]],
  [[0.3, 0.18], [0.7, 0.18], [0.3, 0.5], [0.7, 0.5], [0.3, 0.82], [0.7, 0.82]],
  [[0.3, 0.16], [0.7, 0.16], [0.5, 0.33], [0.3, 0.5], [0.7, 0.5], [0.3, 0.84], [0.7, 0.84]],
  [[0.3, 0.14], [0.7, 0.14], [0.5, 0.3], [0.3, 0.46], [0.7, 0.46], [0.5, 0.64], [0.3, 0.84], [0.7, 0.84]],
  [[0.3, 0.12], [0.7, 0.12], [0.3, 0.36], [0.7, 0.36], [0.5, 0.5], [0.3, 0.64], [0.7, 0.64], [0.3, 0.88], [0.7, 0.88]],
  [[0.3, 0.1], [0.7, 0.1], [0.5, 0.25], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.75], [0.3, 0.9], [0.7, 0.9]],
];

function emblem(card: TarotCard, id: string): G {
  if (card.suit === null) {
    const name = MAJOR_EMBLEM[card.number] ?? 'star8';
    return g(
      {},
      circle(100, 158, 58, { fill: `url(#glow-${id})` }),
      g({ transform: 'translate(100 158) scale(92)' }, shapes[name]()),
    );
  }
  const suit = card.suit;
  if (card.number <= 10) {
    const layout = PIPS[card.number - 1] ?? PIPS[0]!;
    const size = card.number === 1 ? 86 : card.number <= 3 ? 46 : card.number <= 6 ? 38 : 32;
    const box = { x: 48, y: 78, w: 104, h: 168 };
    const items = layout.map(([px, py]) =>
      g({ transform: `translate(${box.x + px * box.w} ${box.y + py * box.h}) scale(${size})` }, suitShape(suit)),
    );
    if (card.number === 1) items.unshift(circle(100, 162, 62, { fill: `url(#glow-${id})` }));
    return g({}, ...items);
  }
  const rankShape: Record<number, G> = {
    11: g({ transform: 'translate(100 98) scale(40)' }, path('M0,0.5 Q-0.1,-0.1 0.35,-0.5 Q0.2,0.05 0,0.5Z', { fill: '#8fc7a0' }), path('M0,0.5 Q0.02,0 0.3,-0.42', { fill: 'none', stroke: IVORY, 'stroke-width': 0.03 })),
    12: g({ transform: 'translate(100 98) scale(44)' }, path('M-0.45,0.2 Q-0.3,-0.4 0.1,-0.45 L0.45,-0.2 L0.2,-0.05 L0.35,0.3 Q0,0.1 -0.1,0.35Z', { fill: GOLD_DEEP, stroke: GOLD, 'stroke-width': 0.04 })),
    13: g({ transform: 'translate(100 98) scale(46)' }, shapes.queenCrown()),
    14: g({ transform: 'translate(100 98) scale(48)' }, shapes.crown()),
  };
  return g(
    {},
    circle(100, 175, 50, { fill: `url(#glow-${id})` }),
    rankShape[card.number] ?? g({}),
    g({ transform: 'translate(100 178) scale(78)' }, suitShape(suit)),
  );
}

function frame(id: string, seed: number): G[] {
  const rand = seeded(seed);
  const stars = Array.from({ length: 22 }, () => {
    const x = 18 + rand() * 164;
    const y = 18 + rand() * 250;
    const r = 0.4 + rand() * 1.2;
    return circle(x, y, r, { fill: IVORY, opacity: (0.35 + rand() * 0.5).toFixed(2) });
  });
  const cornerStar = (x: number, y: number) => g({ transform: `translate(${x} ${y}) scale(9)` }, path(starPath(4, 0.5, 0.14), { fill: GOLD }));
  return [
    svg(
      'defs',
      {},
      svg('linearGradient', { id: `bg-${id}`, x1: 0, y1: 0, x2: 0, y2: 1 }, svg('stop', { offset: 0, 'stop-color': '#221d57' }), svg('stop', { offset: 1, 'stop-color': '#0d0b27' })),
      svg('radialGradient', { id: `glow-${id}` }, svg('stop', { offset: 0, 'stop-color': GOLD, 'stop-opacity': 0.28 }), svg('stop', { offset: 1, 'stop-color': GOLD, 'stop-opacity': 0 })),
    ),
    svg('rect', { x: 0, y: 0, width: 200, height: 300, rx: 10, fill: `url(#bg-${id})` }),
    ...stars,
    path('M32,272 V112 A68,68 0 0 1 168,112 V272Z', { fill: 'rgba(185,164,232,0.08)', stroke: GOLD, 'stroke-width': 0.8, opacity: 0.9 }),
    svg('rect', { x: 8, y: 8, width: 184, height: 284, rx: 7, fill: 'none', stroke: GOLD, 'stroke-width': 1.6 }),
    svg('rect', { x: 13, y: 13, width: 174, height: 274, rx: 5, fill: 'none', stroke: GOLD, 'stroke-width': 0.6, opacity: 0.7 }),
    cornerStar(22, 22),
    cornerStar(178, 22),
    cornerStar(22, 278),
    cornerStar(178, 278),
    g({ transform: 'translate(100 40) scale(16)' }, shapes.crescent()),
  ];
}

export function fallbackCardSvg(card: TarotCard): SVGElement {
  uid += 1;
  const id = String(uid);
  const root = svg('svg', {
    viewBox: '0 0 200 300',
    xmlns: 'http://www.w3.org/2000/svg',
    role: 'img',
    'aria-hidden': 'true',
    class: 'card-svg',
    preserveAspectRatio: 'xMidYMid slice',
  });
  for (const el of frame(id, hash(card.id))) root.appendChild(el);
  root.appendChild(emblem(card, id));
  return root;
}

export function fallbackBackSvg(): SVGElement {
  uid += 1;
  const id = String(uid);
  const root = svg('svg', { viewBox: '0 0 200 300', role: 'img', 'aria-hidden': 'true', class: 'card-svg' });
  for (const el of frame(id, 7)) root.appendChild(el);
  root.appendChild(g({ transform: 'translate(100 150) scale(80)' }, shapes.star8()));
  root.appendChild(g({ transform: 'translate(100 88) scale(34)' }, shapes.crescent()));
  root.appendChild(g({ transform: 'translate(100 212) rotate(180) scale(34)' }, shapes.crescent()));
  return root;
}

export const CARD_COLORS = { GOLD, NAVY, IVORY, LAVENDER };
