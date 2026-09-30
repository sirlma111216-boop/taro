import { dealTable, TABLE_CARD_COUNT, type TableCard } from '../../shared/deck.ts';
import { SPREAD } from '../../shared/spread.ts';
import { getTopic } from '../../shared/topics.ts';
import type { App, Screen } from '../app.ts';
import { cardBack, preloadCardArt } from '../components/card.ts';
import { icon } from '../components/icons.ts';
import { h } from '../dom.ts';
import { CardSelection } from '../selection.ts';

interface Placement {
  x: number;
  y: number;
  w: number;
  rot: number;
  row: number;
  col: number;
}

const ORDINAL = ['첫 번째', '두 번째', '세 번째'];

function rowPattern(count: number, rowCount: number): number[] {
  const base = Math.floor(count / rowCount);
  const extra = count % rowCount;
  return Array.from({ length: rowCount }, (_, i) => base + (i < extra ? 1 : 0));
}

function cardWidthFor(width: number, height: number, rows: number[]): number {
  const maxCols = Math.max(...rows);
  const fan = maxCols >= 6;
  const gap = fan ? 1.1 : 1.12;
  const arcFactor = fan ? 0.16 : 0.05;
  const byWidth = (width * 0.96) / (maxCols * gap);
  const byHeight = (height * 0.94) / (rows.length * 1.5 * 1.08 + arcFactor * 1.5);
  return Math.min(byWidth, byHeight, 150);
}

/**
 * 화면 크기에 맞춰 카드 자리를 계산합니다.
 * 한 줄 부채꼴·두 줄·세 줄(5장씩) 중 카드가 가장 크게 보이는 배치를 고릅니다.
 * 78장을 억지로 겹치지 않고, 무작위로 뽑은 15장만 넉넉한 크기로 펼칩니다.
 */
export function computeLayout(width: number, height: number, count: number): { placements: Placement[]; rows: number[] } {
  const candidates = [1, 2, 3, 4].map((n) => rowPattern(count, n)).filter((rows) => Math.max(...rows) <= 15);
  let rows = candidates[0]!;
  let best = -1;
  for (const candidate of candidates) {
    const w = cardWidthFor(width, height, candidate);
    // 비슷하면 줄 수가 적은(선택하기 쉬운) 배치를 우선합니다.
    if (w > best * 1.04) {
      best = w;
      rows = candidate;
    }
  }
  const maxCols = Math.max(...rows);
  const wide = maxCols >= 6;
  const gap = wide ? 1.1 : 1.12;
  const arcFactor = wide ? 0.16 : 0.05;
  const w = Math.max(38, cardWidthFor(width, height, rows));
  const cardH = w * 1.5;
  const rowGap = cardH * 1.08;
  const totalH = rows.length * rowGap - (rowGap - cardH) + cardH * arcFactor;
  const top0 = (height - totalH) / 2;
  const placements: Placement[] = [];
  rows.forEach((cols, row) => {
    const rowWidth = cols * w * gap - (gap - 1) * w;
    const left0 = (width - rowWidth) / 2;
    for (let col = 0; col < cols; col++) {
      const t = cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0;
      placements.push({
        x: left0 + col * w * gap,
        y: top0 + row * rowGap + cardH * arcFactor * t * t,
        w,
        rot: t * (wide ? 7 : 2.5),
        row,
        col,
      });
    }
  });
  return { placements: placements.slice(0, count), rows };
}

export function buildTable(app: App): Screen {
  const exp = app.experience;
  const topic = getTopic(exp.topicId ?? '');
  exp.table = dealTable();
  let table: TableCard[] = exp.table;
  let selection = new CardSelection(table);
  let dealing = true;
  let focusIndex = 0;
  let layout = { placements: [] as Placement[], rows: [] as number[] };
  let dealVoice: Promise<void> = Promise.resolve();

  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const progress = h('p', { class: 'pick-progress' });
  const spread = h('div', { class: 'spread', role: 'group', 'aria-label': '테이블 위에 펼쳐진 카드' });
  const pile = h('div', { class: 'deck-pile', 'aria-hidden': 'true' }, cardBack(), cardBack(), cardBack());
  spread.appendChild(pile);
  let cardButtons: HTMLButtonElement[] = [];

  const slotFrames = SPREAD.map((pos) => h('div', { class: 'slot-frame', 'data-order': pos.order }, h('span', { class: 'slot-number', 'aria-hidden': 'true' }, String(pos.order))));
  const slots = h(
    'ol',
    { class: 'slots', 'aria-label': '고른 카드 자리' },
    SPREAD.map((pos, i) =>
      h('li', { class: 'slot' }, slotFrames[i], h('span', { class: 'slot-label' }, h('b', null, `${pos.order}`), pos.name)),
    ),
  );

  const undoBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('undo'), h('span', null, '되돌리기'));
  const shuffleBtn = h('button', { type: 'button', class: 'btn btn-ghost' }, icon('shuffle'), h('span', null, '다시 섞기'));
  const confirmBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, icon('sparkle'), h('span', null, '해석 시작'));

  const updateUi = () => {
    const count = selection.count;
    const next = SPREAD[count];
    progress.replaceChildren(
      h('strong', null, `${count} / 3`),
      next ? ` · 다음 자리: ${next.name}` : ' · 세 장을 모두 골랐어요',
    );
    undoBtn.disabled = dealing || count === 0 || selection.isConfirmed;
    shuffleBtn.disabled = dealing || count > 0 || selection.isConfirmed;
    shuffleBtn.hidden = count > 0;
    confirmBtn.disabled = !selection.isComplete || selection.isConfirmed;
    confirmBtn.classList.toggle('is-ready', selection.isComplete && !selection.isConfirmed);
    slotFrames.forEach((f, i) => f.classList.toggle('is-next', i === count && !dealing));
    for (const btn of cardButtons) {
      const slot = Number(btn.dataset.slot);
      const picked = selection.isPicked(slot);
      btn.classList.toggle('is-picked', picked);
      btn.setAttribute('aria-disabled', String(picked || dealing || selection.isComplete));
    }
  };

  const placeButtons = (animate: boolean) => {
    const rect = spread.getBoundingClientRect();
    layout = computeLayout(rect.width, rect.height, table.length);
    const first = layout.placements[0];
    if (first) {
      spread.style.setProperty('--card-w', `${first.w}px`);
      pile.style.left = `${rect.width / 2 - first.w / 2}px`;
      pile.style.top = `${Math.max(4, rect.height / 2 - first.w * 0.75)}px`;
    }
    cardButtons.forEach((btn, i) => {
      const p = layout.placements[i];
      if (!p) return;
      btn.style.left = `${p.x}px`;
      btn.style.top = `${p.y}px`;
      btn.style.width = `${p.w}px`;
      btn.style.height = `${p.w * 1.5}px`;
      btn.style.setProperty('--rot', `${p.rot}deg`);
      if (!animate) btn.style.opacity = '1';
    });
  };

  const setFocus = (index: number, focus = true) => {
    focusIndex = Math.max(0, Math.min(cardButtons.length - 1, index));
    cardButtons.forEach((b, i) => (b.tabIndex = i === focusIndex ? 0 : -1));
    if (focus) cardButtons[focusIndex]?.focus();
  };

  const onCardKey = (event: KeyboardEvent, index: number) => {
    const p = layout.placements[index];
    if (!p) return;
    let target = index;
    if (event.key === 'ArrowRight') target = index + 1;
    else if (event.key === 'ArrowLeft') target = index - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      const candidates = layout.placements
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => q.row === p.row + dir);
      if (candidates.length) {
        target = candidates.reduce((best, c) => (Math.abs(c.q.x - p.x) < Math.abs(best.q.x - p.x) ? c : best)).i;
      }
    } else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = cardButtons.length - 1;
    else return;
    event.preventDefault();
    setFocus(target);
  };

  const createButtons = () => {
    for (const b of cardButtons) b.remove();
    cardButtons = table.map((card, i) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'table-card',
          'data-slot': card.slot,
          'aria-label': `테이블 위 ${i + 1}번째 카드`,
          tabindex: i === 0 ? 0 : -1,
        },
        cardBack(),
      );
      btn.style.opacity = '0';
      btn.addEventListener('click', () => pick(card.slot));
      btn.addEventListener('keydown', (e) => onCardKey(e, i));
      btn.addEventListener('focus', () => (focusIndex = i));
      spread.appendChild(btn);
      return btn;
    });
  };

  const deal = async () => {
    dealing = true;
    updateUi();
    const gen = app.gen;
    pile.style.opacity = '1';
    placeButtons(true);
    const spreadRect = spread.getBoundingClientRect();
    const pileRect = pile.getBoundingClientRect();
    const reduced = app.motion.reduced;
    const stagger = reduced ? 0 : 90;
    cardButtons.forEach((btn, i) => {
      const p = layout.placements[i]!;
      const cx = pileRect.left - spreadRect.left + pileRect.width / 2;
      const cy = pileRect.top - spreadRect.top + pileRect.height / 2;
      const dx = cx - (p.x + p.w / 2);
      const dy = cy - (p.y + (p.w * 1.5) / 2);
      const startRot = (i % 2 ? 1 : -1) * (6 + (i % 5) * 2);
      const anim = app.motion.animate(
        btn,
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(${startRot}deg) scale(0.94)`, opacity: 0, boxShadow: '0 28px 36px rgba(0,0,0,.55)' },
          { opacity: 1, offset: 0.2 },
          { transform: `translate(0, 0) rotate(${p.rot}deg) scale(1)`, opacity: 1, boxShadow: '0 6px 14px rgba(0,0,0,.45)' },
        ],
        { duration: 440, delay: i * stagger, easing: 'cubic-bezier(.18,.8,.25,1)', fill: 'backwards' },
      );
      btn.style.opacity = '1';
      if (!reduced) app.motion.later(i * stagger, () => app.sfx('deal'));
      else if (i === 0) app.sfx('deal');
      void anim;
    });
    await app.motion.wait((table.length - 1) * stagger + 460);
    if (!app.isCurrent(gen)) return;
    app.motion.animate(pile, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    dealing = false;
    updateUi();
    setFocus(0, false);
    // 펼치기 안내가 끝난 뒤, 아직 아무 카드도 고르지 않았다면 선택 안내를 합니다.
    await dealVoice;
    if (app.isCurrent(gen) && selection.count === 0 && !dealing) void app.say('pick_start');
  };

  const flyCard = (from: DOMRect, target: HTMLElement, rot: number, reverse = false) => {
    const to = target.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = from.width / Math.max(to.width, 1);
    const away = { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(${scale})`, boxShadow: '0 30px 40px rgba(0,0,0,.5)' };
    const home = { transform: 'translate(0,0) rotate(0deg) scale(1)', boxShadow: '0 8px 18px rgba(0,0,0,.45)' };
    return app.motion.animate(target, reverse ? [home, away] : [away, home], {
      duration: 520,
      easing: 'cubic-bezier(.2,.75,.2,1)',
      fill: reverse ? 'forwards' : 'backwards',
    });
  };

  function pick(slot: number) {
    if (dealing || selection.isLocked) return;
    const index = selection.pick(slot);
    if (index === null) {
      if (selection.isComplete) app.toast('세 장을 모두 골랐어요. 해석 시작을 눌러 주세요.');
      return;
    }
    selection.lock();
    const btn = cardButtons.find((b) => Number(b.dataset.slot) === slot);
    const frame = slotFrames[index]!;
    const moving = h('div', { class: 'slot-card', 'data-slot': slot }, cardBack());
    frame.appendChild(moving);
    if (btn) {
      const p = layout.placements[cardButtons.indexOf(btn)];
      flyCard(btn.getBoundingClientRect(), moving, p?.rot ?? 0);
    }
    app.sfx('select');
    live.textContent = `${ORDINAL[index]} 카드를 골랐어요. ${SPREAD[index]?.name} 자리에 놓였어요.`;
    void app.say(`pick_${index + 1}` as 'pick_1');
    updateUi();
    app.motion.later(460, () => {
      selection.unlock();
      updateUi();
      if (selection.isComplete) confirmBtn.focus();
    });
  }

  undoBtn.addEventListener('click', () => {
    if (dealing) return;
    const card = selection.undo();
    if (!card) return;
    selection.lock();
    const index = selection.count;
    const frame = slotFrames[index]!;
    const moving = frame.querySelector<HTMLElement>('.slot-card');
    const btn = cardButtons.find((b) => Number(b.dataset.slot) === card.slot);
    if (moving && btn) {
      const anim = flyCard(btn.getBoundingClientRect(), moving, layout.placements[cardButtons.indexOf(btn)]?.rot ?? 0, true);
      void app.motion.finished(anim).then(() => moving.remove());
    } else moving?.remove();
    app.sfx('flip');
    live.textContent = `${ORDINAL[index]} 카드를 되돌렸어요.`;
    updateUi();
    app.motion.later(420, () => {
      selection.unlock();
      updateUi();
      btn?.focus();
    });
  });

  shuffleBtn.addEventListener('click', () => {
    if (dealing || selection.count > 0) return;
    exp.table = dealTable();
    table = exp.table;
    selection = new CardSelection(table);
    for (const b of cardButtons) {
      app.motion.animate(b, [{ opacity: 1 }, { opacity: 0, transform: `rotate(${b.style.getPropertyValue('--rot')}) translateY(-20px)` }], { duration: 250, fill: 'forwards' });
    }
    dealing = true;
    updateUi();
    app.motion.later(app.motion.reduced ? 0 : 260, () => {
      createButtons();
      void deal();
    });
  });

  confirmBtn.addEventListener('click', async () => {
    const drawn = selection.confirm();
    if (!drawn) return;
    const gen = app.gen;
    updateUi();
    // 해석 화면에서 크게 뒤집어 보여 주므로, 여기서는 고른 세 장을 살짝 들어 올리는 동작만 합니다.
    preloadCardArt(drawn.map((d) => d.id));
    app.sfx('select');
    const lifts = slotFrames.map((frame, i) => {
      const card = frame.querySelector<HTMLElement>('.slot-card');
      return card
        ? app.motion.animate(card, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-14px) scale(1.06)', boxShadow: '0 0 28px rgba(241,217,164,.6)' }], {
            duration: 380,
            delay: i * 90,
            easing: 'cubic-bezier(.2,.7,.2,1)',
            fill: 'forwards',
          })
        : null;
    });
    await Promise.all(lifts.map((a) => (a ? app.motion.finished(a) : Promise.resolve())));
    if (!app.isCurrent(gen)) return;
    app.confirmCards(drawn);
  });

  const resize = new ResizeObserver(() => {
    if (!dealing) placeButtons(false);
  });

  const el = h(
    'div',
    { class: 'table-screen' },
    h(
      'header',
      { class: 'table-head' },
      h('p', { class: 'eyebrow' }, topic ? `세 번째 선택 · ${topic.name}` : '세 번째 선택'),
      h('h1', { id: 'table-title' }, '마음에 들어오는 카드 세 장을 차례로 골라 주세요'),
      h('p', { class: 'deck-note' }, `78장 전체 덱을 섞은 뒤, 무작위로 뽑은 ${TABLE_CARD_COUNT}장을 펼쳤어요. 카드의 방향도 섞을 때 이미 정해졌어요.`),
      progress,
      live,
    ),
    spread,
    h('div', { class: 'table-bottom' }, slots, h('div', { class: 'table-actions' }, undoBtn, shuffleBtn, confirmBtn)),
  );
  // 스크롤되는 화면 요소(el) 안쪽에 격자를 두어, 낮은 화면에서도 아래쪽 자막 여백이 버튼 뒤에 남도록 합니다.
  const layoutEl = h('div', { class: 'table-layout' });
  layoutEl.append(...el.childNodes);
  el.appendChild(layoutEl);

  createButtons();
  updateUi();

  return {
    name: 'table',
    el,
    scene: 'table',
    music: 'select',
    onShown: () => {
      resize.observe(spread);
      dealVoice = app.say('deal');
      // 화면 전환이 자리 잡은 뒤 카드를 펼칩니다.
      app.motion.later(app.motion.reduced ? 50 : 520, () => void deal());
    },
    dispose: () => resize.disconnect(),
  };
}
