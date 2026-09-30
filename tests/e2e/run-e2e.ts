/*
 * 별빛서가 E2E 테스트 (실제 브라우저로 전체 흐름 확인)
 *   npm run test:e2e
 * 결과 스크린샷·PDF·보고서: tests/e2e/output/
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { getCard } from '../../src/shared/cards.ts';
import { BASE, expect, expectEqual, expiredToken, launchBrowser, OUT, prepareConfig, results, startServer, test, type TestEnv } from './harness.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 음성합성 흉내: 한국어 음성 1개, 말한 문장과 취소 횟수를 기록 */
const FAKE_SPEECH = `(() => {
  const log = { spoken: [], cancels: 0 };
  window.__speech = log;
  const voice = { lang: 'ko-KR', name: 'Test Korean Female', default: true, localService: true, voiceURI: 'test-ko' };
  let pending = [];
  const synth = {
    getVoices: () => [voice],
    speak(u) { log.spoken.push(u.text); const t = setTimeout(() => { pending = pending.filter(p => p.u !== u); u.onend && u.onend({}); }, 1200); pending.push({ u, t }); },
    cancel() { log.cancels++; const list = pending; pending = []; for (const p of list) { clearTimeout(p.t); p.u.onerror && p.u.onerror({ error: 'interrupted' }); } },
    pause() {}, resume() {}, speaking: false, pending: false, paused: false,
    addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  window.__printCalls = 0;
  window.print = () => { window.__printCalls++; setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); };
})();`;

async function newPage(browser: Browser, options: { width?: number; height?: number; reducedMotion?: 'reduce' | 'no-preference'; hasTouch?: boolean; isMobile?: boolean } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1366, height: options.height ?? 768 },
    reducedMotion: options.reducedMotion ?? 'no-preference',
    hasTouch: options.hasTouch ?? false,
    isMobile: options.isMobile ?? false,
    locale: 'ko-KR',
  });
  await context.addInitScript(FAKE_SPEECH);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) pageErrors.push(m.text());
  });
  return { context, page };
}

const pageErrors: string[] = [];

const screen = (page: Page) => page.evaluate(() => document.getElementById('app')!.dataset.screen ?? '');

async function waitScreen(page: Page, name: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction((n) => document.getElementById('app')!.dataset.screen === n && !document.querySelector('.screen.is-leaving'), name, { timeout });
}

async function login(page: Page, env: TestEnv, query = ''): Promise<void> {
  await page.goto(`${BASE}/${query}`);
  await waitScreen(page, 'login');
  await page.fill('#login-username', env.username);
  await page.fill('#login-password', env.password);
  await page.click('.login-form button[type=submit]');
  try {
    await waitScreen(page, 'title');
  } catch (error) {
    const state = await page.evaluate(() => ({
      screen: document.getElementById('app')!.dataset.screen,
      message: document.querySelector('.form-message')?.textContent,
      leaving: document.querySelectorAll('.screen.is-leaving').length,
      screens: [...document.querySelectorAll('.screen')].map((s) => s.className),
    }));
    await shot(page, `login-failure-${Date.now()}`);
    throw new Error(`로그인 후 타이틀로 가지 못함: ${JSON.stringify(state)}\n${String(error)}`);
  }
}

/** 타이틀에서 카드 테이블까지 진행하고 카드 펼치기가 끝날 때까지 기다립니다. */
async function toTable(page: Page, topic = 'friends'): Promise<void> {
  await page.click('.title-start');
  await waitScreen(page, 'topic');
  await page.click(`[data-topic="${topic}"]`);
  await waitScreen(page, 'table');
  await page.waitForFunction(() => document.querySelectorAll('.table-card[aria-disabled="false"]').length === 15, null, { timeout: 15_000 });
}

async function pickThree(page: Page, slots = [1, 6, 12]): Promise<{ id: string; reversed: boolean }[]> {
  for (const slot of slots) {
    await page.click(`.table-card[data-slot="${slot}"]`);
    await sleep(520);
  }
  return page.evaluate((s) => {
    const table = (window as any).__app.experience.table as { id: string; reversed: boolean }[];
    return s.map((i) => ({ id: table[i]!.id, reversed: table[i]!.reversed }));
  }, slots);
}

function captureReadingRequests(page: Page): { id: string; reversed: boolean }[][] & { bodies: any[] } {
  const list = [] as unknown as { id: string; reversed: boolean }[][] & { bodies: any[] };
  list.bodies = [];
  page.on('request', (req) => {
    if (req.url().endsWith('/api/reading') && req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      list.bodies.push(body);
      list.push(body.cards);
    }
  });
  return list;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

/** 가로 넘침과 주요 버튼이 화면 밖/자막 아래로 가려지는지 확인 */
async function layoutProblems(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((sels) => {
    const problems: string[] = [];
    const vw = innerWidth;
    const vh = innerHeight;
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`페이지 가로 스크롤 ${document.documentElement.scrollWidth}>${vw}`);
    const active = document.querySelector('.screen:not(.is-leaving)') as HTMLElement | null;
    if (active && active.scrollWidth > active.clientWidth + 1) problems.push(`화면 가로 넘침 ${active.scrollWidth}>${active.clientWidth}`);
    // 글자가 잘린 요소(한 줄 말줄임 제외)
    for (const el of active?.querySelectorAll<HTMLElement>('h1, h2, h3, p, button, .topic-name, .topic-question, .slot-label') ?? []) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.matches('.sr-only, .title-start')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') problems.push(`잘린 글자: ${el.className || el.tagName} "${el.textContent?.slice(0, 20)}"`);
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) problems.push(`화면 밖으로 나감: ${el.className || el.tagName} "${el.textContent?.slice(0, 16)}"`);
    }
    const caption = document.getElementById('caption')!;
    // 모달(인쇄 창)이 열려 있으면 자막은 모달 아래에 깔리므로 가림 검사에서 제외
    const modalOpen = document.getElementById('modal-root')!.childElementCount > 0;
    const capVisible = !modalOpen && caption.classList.contains('is-visible') && Number(getComputedStyle(caption).opacity) > 0.5;
    const cap = caption.getBoundingClientRect();
    for (const sel of sels) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) {
        problems.push(`없음: ${sel}`);
        continue;
      }
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      if (r.bottom > vh + 1 || r.top < 0 || r.right > vw + 1 || r.left < 0) problems.push(`화면 밖: ${sel} (${Math.round(r.top)}~${Math.round(r.bottom)} / ${vh})`);
      const overlap = capVisible && r.bottom > cap.top && r.top < cap.bottom && r.right > cap.left && r.left < cap.right;
      if (overlap) problems.push(`자막에 가려짐: ${sel}`);
      if (r.height < 40 && el.tagName === 'BUTTON') problems.push(`터치 영역이 작음: ${sel} (${Math.round(r.height)}px)`);
    }
    return problems;
  }, selectors);
}

async function main(): Promise<void> {
  console.log('E2E 준비: 테스트 전용 설정 생성 → 개발 서버 시작 → 브라우저 실행');
  const env = await prepareConfig();
  const server = await startServer();
  const browser = await launchBrowser();
  console.log(`브라우저: ${browser.version()}`);

  try {
    // ------------------------------------------------------------ 인증·API 보호
    await test('비로그인 상태: 세션 없음, 해석 API 401, 다른 출처 요청 403', async () => {
      const session = await (await fetch(`${BASE}/api/session`)).json();
      expectEqual(session.authenticated, false, '세션이 없어야 함');
      const body = JSON.stringify({ topicId: 'friends', requestId: 'req_e2e_000001', cards: [{ id: 'major-00', reversed: false }, { id: 'major-01', reversed: false }, { id: 'major-02', reversed: false }] });
      const r1 = await fetch(`${BASE}/api/reading`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body });
      expectEqual(r1.status, 401, '비로그인 해석 요청은 401');
      const r2 = await fetch(`${BASE}/api/reading`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body });
      expectEqual(r2.status, 403, '다른 출처는 403');
      const r3 = await fetch(`${BASE}/api/reading`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: 'sl_session=v1.forged.token' }, body });
      expectEqual(r3.status, 401, '위조 쿠키는 401');
    });

    await test('로그인: 틀린 비밀번호 거부 → 올바른 로그인 → HttpOnly 쿠키', async () => {
      const { context, page } = await newPage(browser);
      await page.goto(BASE);
      await waitScreen(page, 'login');
      await page.fill('#login-username', env.username);
      await page.fill('#login-password', 'not-the-password');
      await page.click('.login-form button[type=submit]');
      await page.waitForFunction(() => (document.querySelector('.form-message')?.textContent ?? '').length > 0);
      expect((await page.textContent('.form-message'))?.includes('올바르지 않습니다'), '오류 문구');
      expectEqual(await screen(page), 'login', '여전히 로그인 화면');
      await page.fill('#login-password', env.password);
      await page.click('.login-form button[type=submit]');
      await waitScreen(page, 'title');
      const cookies = await context.cookies();
      const c = cookies.find((x) => x.name === 'sl_session');
      expect(c && c.httpOnly && c.sameSite === 'Strict', 'HttpOnly·SameSite=Strict 세션 쿠키');
      expectEqual(await page.evaluate(() => document.cookie.includes('sl_session')), false, '스크립트에서 쿠키를 읽을 수 없어야 함');
      await shot(page, 'desktop-01-title');
      await context.close();
    });

    await test('만료된 세션 쿠키는 로그인 화면으로 보냄', async () => {
      const { context, page } = await newPage(browser);
      await context.addCookies([{ name: 'sl_session', value: await expiredToken(env), url: BASE, httpOnly: true, sameSite: 'Strict' }]);
      await page.goto(BASE);
      await waitScreen(page, 'login');
      await context.close();
    });

    // ------------------------------------------------------------ 전체 흐름
    await test('전체 흐름: 주제·카드 선택·해석·카드 3장·종합·이름·인쇄·종료', async () => {
      const { context, page } = await newPage(browser);
      const sent = captureReadingRequests(page);
      await login(page, env);
      await page.click('.title-start');
      await waitScreen(page, 'topic');
      expectEqual(await page.locator('.topic-card').count(), 12, '주제 12개를 한 번에 보여 줌');
      expectEqual(await page.locator('.tabs, #tab-all, .screen-topic .eyebrow').count(), 0, '추천/전체 버튼과 단계 문구 없음');
      const columns = await page.$eval('.topic-grid', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expectEqual(columns, 4, '한 줄에 4개(4×3)');
      await shot(page, 'desktop-03-topic');
      await page.click('[data-topic="game"]');
      await waitScreen(page, 'table');
      await page.waitForFunction(() => document.querySelectorAll('.table-card[aria-disabled="false"]').length === 15, null, { timeout: 15_000 });
      await shot(page, 'desktop-04-table');

      // 키보드로 첫 카드 고르기: 오른쪽 화살표 두 번 → Enter
      await page.focus('.table-card[data-slot="0"]');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      const focusedSlot = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.slot);
      expectEqual(focusedSlot, '2', '화살표로 포커스 이동');
      await page.keyboard.press('Enter');
      await sleep(550);
      // 같은 카드 다시 클릭(무시), 빠른 연속 클릭
      await page.click('.table-card[data-slot="2"]', { force: true });
      await page.click('.table-card[data-slot="8"]');
      await page.click('.table-card[data-slot="9"]', { force: true, delay: 0 });
      await sleep(550);
      await page.click('.table-card[data-slot="13"]');
      await sleep(550);
      await page.click('.table-card[data-slot="4"]', { force: true }); // 4번째는 무시
      await sleep(300);
      const picks = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.slot-card')].map((e) => Number(e.dataset.slot)));
      expectEqual(picks, [2, 8, 13], '선택 순서 유지·중복 방지·세 장 제한');
      const expected = await page.evaluate((s) => s.map((i) => ({ id: (window as any).__app.experience.table[i].id, reversed: (window as any).__app.experience.table[i].reversed })), picks);
      await shot(page, 'desktop-05-picked');

      await page.click('.table-actions .btn-primary');
      await waitScreen(page, 'reading', 10_000);
      await shot(page, 'desktop-06-reading');
      await waitScreen(page, 'card', 15_000);
      expectEqual(sent[0], expected, 'AI 요청에 보낸 카드·방향·순서가 고른 것과 같음');
      expectEqual(sent.bodies[0].topicId, 'game', '주제 ID');
      expect(!('gender' in sent.bodies[0]), '성별은 AI 요청에 보내지 않음');

      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          await page.click('.detail-nav .btn-primary');
          await page.waitForFunction((n) => document.querySelector('.screen-card:not(.is-leaving) .detail-top .eyebrow')?.textContent?.startsWith(`${n} / 3`), i + 1);
        }
        const card = getCard(expected[i]!.id)!;
        const name = await page.textContent('.screen-card:not(.is-leaving) .detail-name');
        expect(name?.startsWith(card.nameKo), `${i + 1}번째 카드 이름 ${card.nameKo} / 화면: ${name}`);
        const tag = await page.textContent('.screen-card:not(.is-leaving) .detail-tags .tag');
        expectEqual(tag, expected[i]!.reversed ? '역방향' : '정방향', `${i + 1}번째 카드 방향`);
        const rev = await page.evaluate(() => document.querySelector('.screen-card:not(.is-leaving) .detail-card .card-face')!.classList.contains('is-reversed'));
        expectEqual(rev, expected[i]!.reversed, '그림 방향');
        expect(await page.locator('.screen-card:not(.is-leaving) .mock-badge').count(), '모의 응답 표시');
        await shot(page, `desktop-07-card-${i + 1}`);
      }
      // 이전 카드로 돌아가기
      await page.click('.detail-nav .btn-ghost');
      await page.waitForFunction(() => document.querySelector('.screen-card:not(.is-leaving) .detail-top .eyebrow')?.textContent?.startsWith('2 / 3'));
      await page.click('.detail-nav .btn-primary');
      await page.waitForFunction(() => document.querySelector('.screen-card:not(.is-leaving) .detail-top .eyebrow')?.textContent?.startsWith('3 / 3'));
      expectEqual((await page.textContent('.screen-card:not(.is-leaving) .detail-nav .btn-primary'))?.trim(), '종합 해석 보기', '마지막 카드 버튼');
      await page.click('.detail-nav .btn-primary');
      await waitScreen(page, 'summary');
      const summaryNames = await page.$$eval('.summary-card-name', (els) => els.map((e) => e.textContent));
      expectEqual(summaryNames, expected.map((d) => `${getCard(d.id)!.nameKo} · ${d.reversed ? '역방향' : '정방향'}`), '종합 화면 카드 목록');
      await shot(page, 'desktop-08-summary');

      // 인쇄: 먼저 이름 창 → 받침 있는 두 글자 이름은 '지훈이의'가 기본, '지훈의'로도 바꿀 수 있음
      await page.click('.summary-actions .btn-primary');
      await page.waitForSelector('.name-dialog #print-name');
      await sleep(300);
      expectEqual(await page.evaluate(() => document.activeElement?.id), 'print-name', '이름 칸에 포커스');
      await page.keyboard.type('지훈');
      await sleep(150);
      expectEqual((await page.textContent('.name-preview'))?.replace('✦', '').trim(), '지훈이의 별빛서가', '받침 이름 기본 미리보기');
      const options = await page.$$eval('.name-option', (els) => els.map((e) => e.textContent));
      expectEqual(options, ['지훈의 별빛서가', '지훈이의 별빛서가'], '부르는 형태 선택지');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.print-dialog');
      await sleep(700);
      expectEqual(await page.textContent('.print-name-value'), '지훈이의 별빛서가', '인쇄 창의 카드 제목');
      expectEqual(
        await page.$eval('.print-preview .pc-title', (el) => el.textContent),
        '지훈이의  별빛서가',
        '엽서 제목: 한 줄, 두 단어 사이 두 칸',
      );
      expectEqual(await page.textContent('.print-preview .pc-cards-label'), '지훈이가 고른 세 장', '이름 뒤 조사(이/가)');
      // 이름 바꾸기 → '민지' → 조사가 '가'로
      await page.click('.print-name-row .chip');
      await page.waitForSelector('.name-dialog #print-name');
      await page.fill('#print-name', '민지');
      await sleep(150);
      expectEqual(await page.locator('.name-option').count(), 0, '받침 없는 이름은 선택지 없음');
      await page.click('.name-actions .btn-primary');
      await page.waitForSelector('.print-dialog');
      await sleep(500);
      expectEqual(await page.textContent('.print-preview .pc-cards-label'), '민지가 고른 세 장', '받침 없는 이름 조사');
      expect(!(await page.textContent('.print-preview .pc-cheer'))?.includes('민지야'), '응원 문장에 반말 호칭을 붙이지 않음');
      expectEqual(await page.getAttribute('.print-preview .print-card', 'data-size'), 'postcard', '기본 엽서 사이즈');
      await shot(page, 'desktop-09-print-postcard');
      for (const size of ['postcard', 'card'] as const) {
        await page.check(`#size-${size}`);
        await sleep(200);
        expectEqual(await page.getAttribute('.print-preview .print-card', 'data-size'), size, `미리보기 ${size}`);
        await sleep(400);
        if (size === 'card') await shot(page, 'desktop-10-print-card');
        await page.click('.print-actions .btn-primary');
        await page.waitForFunction(() => (document.querySelector('.print-status')?.textContent ?? '').includes('인쇄 창이 닫혔어요'));
        const status = await page.textContent('.print-status');
        expect(!status?.includes('성공'), '인쇄 성공이라고 표시하지 않음');
        const overflow = await page.getAttribute('#print-root .print-card', 'data-overflow');
        expectEqual(overflow, 'false', `${size} 글이 안전 영역 안에 들어감`);
        await page.emulateMedia({ media: 'print' });
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        writeFileSync(join(OUT, `print-${size}.pdf`), pdf);
        const noBg = await page.pdf({ preferCSSPageSize: true, printBackground: false });
        writeFileSync(join(OUT, `print-${size}-no-background.pdf`), noBg);
        await page.emulateMedia({ media: 'screen' });
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        expectEqual(pages, 1, `${size} 인쇄물은 한 페이지`);
      }
      expectEqual(await page.evaluate(() => (window as any).__printCalls), 2, '브라우저 인쇄 기능 호출');
      expectEqual(await screen(page), 'summary', '인쇄 후에도 결과 화면 유지');
      await page.click('.print-actions .btn-ghost');

      await page.click('.summary-actions .btn-ghost');
      await waitScreen(page, 'title');
      const cleared = await page.evaluate(() => (window as any).__app.experience);
      expectEqual(cleared, { topicId: null, table: null, drawn: null, requestId: null, result: null, cardIndex: 0, printName: null }, '종료 후 이전 체험 데이터(기념 카드 이름 포함) 비움');
      expectEqual(await page.evaluate(() => document.getElementById('print-root')!.childElementCount), 0, '인쇄 영역 비움');
      const session = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
      expectEqual(session.authenticated, true, '운영자 로그인은 유지');
      await context.close();
    });

    await test('인쇄: 서버가 허용하는 최대 길이 문장도 엽서·카드 사이즈 안전 영역 안에 들어감', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env);
      const results = await page.evaluate(async () => {
        // 브라우저(개발 서버)에서 모듈을 직접 불러옵니다. 경로는 문자열 변수로 넘겨 Node 쪽 타입 해석을 피합니다.
        const printUrl = '/src/client/print.ts';
        const readingUrl = '/src/shared/reading.ts';
        const print = (await import(/* @vite-ignore */ printUrl)) as typeof import('../../src/client/print.ts');
        const { LIMITS } = (await import(/* @vite-ignore */ readingUrl)) as typeof import('../../src/shared/reading.ts');
        const fill = (n: number) => '별빛이 비추는 작은 용기 한 걸음 '.repeat(20).slice(0, n);
        const p = LIMITS.print;
        const data = {
          appName: '별빛서가',
          topicName: '오늘의 작은 행운',
          print: {
            headline: fill(p.headline.max),
            advice: fill(p.advice.max),
            caution: fill(p.caution.max),
            cheer: fill(p.cheer.max),
            miniAdvice: fill(p.miniAdvice.max),
            miniCaution: fill(p.miniCaution.max),
          },
          cards: [
            { id: 'major-10', reversed: true },
            { id: 'pentacles-12', reversed: false },
            { id: 'swords-11', reversed: true },
          ],
          date: new Date(),
          isMock: false,
          // 가장 긴 이름(10자)으로 제목까지 함께 확인
          name: { raw: '가나다라마바사아자차', call: '가나다라마바사아자차' },
        };
        const out: Record<string, { fit: number; overflow: string | undefined }> = {};
        for (const size of ['postcard', 'card'] as const) {
          const el = print.renderPrintCard(size, data);
          el.style.position = 'fixed';
          el.style.left = '0';
          el.style.top = '0';
          document.body.appendChild(el);
          await document.fonts.ready;
          const fit = print.fitPrintCard(el);
          out[size] = { fit, overflow: el.dataset.overflow };
          el.remove();
        }
        return out;
      });
      for (const size of ['postcard', 'card']) {
        expectEqual(results[size]?.overflow, 'false', `${size} 최대 길이에서 넘침 없음 (글자 배율 ${results[size]?.fit})`);
        expect((results[size]?.fit ?? 0) >= 0.8, `${size} 글자가 너무 작아지지 않음 (배율 ${results[size]?.fit})`);
      }
      await context.close();
    });

    await test('소리: 배경음악 파일 재생·장면별 교체·반복 교차 페이드, 효과음 파일 해독', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env);
      const state = () =>
        page.evaluate(() => {
          const audio = (window as any).__app.audio;
          const track = audio.currentTrack;
          const els = track ? (track.els as HTMLAudioElement[]) : [];
          return {
            ctx: audio.ctx?.state as string | undefined,
            src: track?.spec.src as string | undefined,
            playing: Boolean(track?.isPlaying),
            active: track?.active as number | undefined,
            times: els.map((e) => ({ t: e.currentTime, paused: e.paused, dur: e.duration })),
            buffers: [...(audio.sfxBuffers as Map<string, unknown>).entries()].map(([k, v]) => [k, v instanceof AudioBuffer ? 'ok' : v]),
          };
        });
      await page.click('.title-start');
      await waitScreen(page, 'topic');
      await sleep(2500);
      const s1 = await state();
      expectEqual(s1.ctx, 'running', '클릭 뒤 오디오 시작');
      expectEqual(s1.src, 'audio/music/bgm-selection.mp3', '선택 화면 배경음악');
      expect(s1.playing && (s1.times[0]?.t ?? 0) > 0.5, `음악이 실제로 흐름 (${JSON.stringify(s1.times)})`);
      expect(s1.buffers.length === 3 && s1.buffers.every(([, v]) => v === 'ok'), `효과음 3개 해독 ${JSON.stringify(s1.buffers)}`);
      // 반복 지점 근처로 이동 → 다른 요소가 처음부터 겹쳐 시작해야 함
      await page.evaluate(() => {
        const track = (window as any).__app.audio.currentTrack;
        const el = track.els[track.active] as HTMLAudioElement;
        el.currentTime = el.duration - 5.2;
      });
      await sleep(1500);
      const s2 = await state();
      expectEqual(s2.active, 1, '반복 교차 페이드로 두 번째 재생기로 넘어감');
      expect((s2.times[1]?.t ?? 0) > 0.3 && !s2.times[1]?.paused, `다음 반복이 처음부터 재생 중 ${JSON.stringify(s2.times)}`);
      // 장면이 바뀌면 곡도 바뀜
      await page.click('[data-topic="study"]');
      await waitScreen(page, 'table');
      await page.evaluate(() => (window as any).__app.audio.playMusic('result'));
      await sleep(2500);
      const s3 = await state();
      expectEqual(s3.src, 'audio/music/bgm-result.mp3', '결과 배경음악으로 교체');
      expect(s3.playing && (s3.times[0]?.t ?? 0) > 0.5, '결과 음악 재생');
      await context.close();
    });

    // ------------------------------------------------------------ 긴급 복귀
    await test('Escape: 한 번은 안내만, 1초 넘기면 초기화 안 됨, 누르고 있기(반복)는 무시, 두 번이면 복귀', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env);
      await toTable(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#toast.is-visible');
      expect((await page.textContent('#toast'))?.includes('한 번 더 누르면'), '첫 Escape 안내');
      await sleep(1250);
      await page.keyboard.press('Escape');
      await sleep(200);
      expectEqual(await screen(page), 'table', '1초가 지나면 두 번째 입력이 아닌 첫 입력으로 처리');
      await sleep(1250);
      await page.keyboard.down('Escape');
      await page.keyboard.down('Escape'); // 자동 반복
      await page.keyboard.down('Escape');
      await page.keyboard.up('Escape');
      await sleep(300);
      expectEqual(await screen(page), 'table', '키를 누르고 있어 생긴 반복 입력은 무시');
      await sleep(1250);
      await page.keyboard.press('Escape');
      await sleep(150);
      await page.keyboard.press('Escape');
      await waitScreen(page, 'title');
      await context.close();
    });

    await test('해석 중 긴급 복귀: 음성 중단, 늦게 온 응답 무시', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env, '?mock=slow');
      await toTable(page);
      await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await waitScreen(page, 'reading', 10_000);
      await sleep(800);
      const before = await page.evaluate(() => ({ ...(window as any).__speech, spoken: [...(window as any).__speech.spoken] }));
      await page.keyboard.press('Escape');
      await sleep(120);
      await page.keyboard.press('Escape');
      await waitScreen(page, 'title');
      const after = await page.evaluate(() => (window as any).__speech);
      expect(after.cancels > before.cancels, '복귀할 때 음성 취소');
      const spokenAfterReset = after.spoken.length;
      await sleep(7000); // 모의 응답은 6초 뒤 도착
      expectEqual(await screen(page), 'title', '늦게 도착한 응답이 화면을 덮어쓰지 않음');
      const state = await page.evaluate(() => (window as any).__app.experience.result);
      expectEqual(state, null, '늦은 결과는 저장되지 않음');
      const spoken = await page.evaluate(() => (window as any).__speech.spoken.length);
      expect(spoken <= spokenAfterReset + 1, '복귀 후 해석 관련 음성이 이어지지 않음');
      expectEqual(await page.evaluate(() => (window as any).__app.motion.activeCount), 0, '진행 중 타이머·애니메이션 정리');
      await context.close();
    });

    await test('처음으로 버튼(터치용): 두 번 눌러야 복귀', async () => {
      const { context, page } = await newPage(browser, { width: 1024, height: 768, hasTouch: true });
      await login(page, env);
      await toTable(page);
      await page.tap('.chip.home');
      await sleep(200);
      expectEqual(await screen(page), 'table', '한 번은 안내만');
      await page.tap('.chip.home');
      await waitScreen(page, 'title');
      await context.close();
    });

    // ------------------------------------------------------------ 오류·재시도
    await test('AI 오류 → 같은 카드로 다시 시도 → 결과', async () => {
      const { context, page } = await newPage(browser);
      const sent = captureReadingRequests(page);
      await login(page, env, '?mock=error');
      await toTable(page);
      const expected = await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await page.waitForSelector('.reading-screen.has-error', { timeout: 15_000 });
      await shot(page, 'desktop-11-error');
      expect((await page.textContent('.reading-keep'))?.includes('바뀌지 않아요'), '카드 유지 안내');
      await page.evaluate(() => history.replaceState(null, '', '/?mock=ok'));
      await page.click('.reading-actions .btn-primary');
      await waitScreen(page, 'card', 15_000);
      expectEqual(sent.length, 2, '요청 두 번');
      expectEqual(sent[0], expected, '첫 요청 카드');
      expectEqual(sent[1], expected, '재시도해도 카드·방향·순서 동일');
      expect(sent.bodies[0].requestId !== sent.bodies[1].requestId, '재시도는 새 요청 ID');
      await context.close();
    });

    await test('브라우저 쪽 시간 초과 → 오류 화면 → 재시도', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env, '?mock=hang&clientTimeout=3000');
      await toTable(page);
      await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await page.waitForSelector('.reading-screen.has-error', { timeout: 15_000 });
      expect((await page.textContent('.reading-title'))?.includes('오래 걸리고'), '시간 초과 문구');
      await page.evaluate(() => history.replaceState(null, '', '/?mock=ok'));
      await page.click('.reading-actions .btn-primary');
      await waitScreen(page, 'card', 15_000);
      await context.close();
    });

    await test('잘못된 형식의 AI 응답은 결과 대신 오류로 처리', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env, '?mock=bad-json');
      await toTable(page);
      await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await page.waitForSelector('.reading-screen.has-error', { timeout: 15_000 });
      expectEqual(await page.evaluate(() => (window as any).__app.experience.result), null, '결과 없음');
      expect((await page.textContent('.reading-title'))?.includes('다시 받아 볼게요'), '형식 오류 문구');
      await context.close();
    });

    await test('해석 중 세션 만료(401) → 운영자 다시 로그인 → 같은 카드로 이어서 해석', async () => {
      const { context, page } = await newPage(browser);
      const sent = captureReadingRequests(page);
      await login(page, env);
      await toTable(page);
      const expected = await pickThree(page);
      await context.clearCookies();
      await page.click('.table-actions .btn-primary');
      await page.waitForSelector('.reading-screen.has-error', { timeout: 15_000 });
      await page.click('.reading-actions .btn-primary');
      await page.waitForSelector('.login-modal #login-username');
      await page.fill('.login-modal #login-username', env.username);
      await page.fill('.login-modal #login-password', env.password);
      await page.click('.login-modal button[type=submit]');
      await waitScreen(page, 'card', 15_000);
      expectEqual(sent.at(-1), expected, '다시 로그인 후에도 같은 카드');
      await context.close();
    });

    await test('운영자 로그아웃: 두 번 눌러 로그아웃 → 로그인 화면, API 거부', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env);
      await page.click('.title-footer .chip');
      expectEqual(await screen(page), 'title', '한 번은 확인만');
      await page.click('.title-footer .chip');
      await waitScreen(page, 'login');
      const status = await page.evaluate(() =>
        fetch('/api/reading', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: 'friends', requestId: 'req_after_logout', cards: [{ id: 'major-00', reversed: false }, { id: 'major-01', reversed: false }, { id: 'major-02', reversed: false }] }) }).then((r) => r.status),
      );
      expectEqual(status, 401, '로그아웃 후 해석 API 401');
      await context.close();
    });

    // ------------------------------------------------------------ 접근성·환경
    await test('움직임 줄이기 설정에서도 전체 흐름 동작', async () => {
      const { context, page } = await newPage(browser, { reducedMotion: 'reduce' });
      await login(page, env);
      const started = Date.now();
      await toTable(page);
      await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await waitScreen(page, 'card', 15_000);
      const reduced = await page.evaluate(() => (window as any).__app.motion.reduced);
      expectEqual(reduced, true, '움직임 줄이기 감지');
      expect(Date.now() - started < 20_000, '빠르게 진행');
      await context.close();
    });

    await test('소리 없는 환경(음성 없음·음악/음성 끔)에서도 자막과 흐름 유지', async () => {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.addInitScript(() => {
        Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
        (window as any).AudioContext = undefined;
        (window as any).webkitAudioContext = undefined;
      });
      const page = await context.newPage();
      await login(page, env);
      await page.click('.topbar .toggle >> nth=0');
      await page.click('.topbar .toggle >> nth=1');
      expectEqual(await page.getAttribute('.topbar .toggle >> nth=0', 'aria-pressed'), 'false', '음악 끔');
      await toTable(page);
      expect(await page.locator('#caption.is-visible').count(), '자막 표시');
      await pickThree(page);
      await page.click('.table-actions .btn-primary');
      await waitScreen(page, 'card', 15_000);
      await context.close();
    });

    await test('키보드만으로 진행 (Tab·Enter)', async () => {
      const { context, page } = await newPage(browser);
      await login(page, env);
      await sleep(400);
      const focused = await page.evaluate(() => document.activeElement?.className ?? '');
      expect(focused.includes('title-start'), `시작 버튼에 포커스 (${focused})`);
      await page.keyboard.press('Enter');
      await waitScreen(page, 'topic');
      await sleep(300);
      await page.keyboard.press('Enter');
      await waitScreen(page, 'table');
      await page.waitForFunction(() => document.querySelectorAll('.table-card[aria-disabled="false"]').length === 15, null, { timeout: 15_000 });
      await page.focus('.table-card[data-slot="0"]');
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await sleep(550);
      }
      const active = await page.evaluate(() => document.activeElement?.textContent);
      expect(active?.includes('해석 시작'), '세 장을 고르면 해석 시작 버튼으로 포커스');
      await page.keyboard.press('Enter');
      await waitScreen(page, 'card', 15_000);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.screen-card:not(.is-leaving) .detail-top .eyebrow')?.textContent?.startsWith('2 / 3'));
      await context.close();
    });

    // ------------------------------------------------------------ 화면 크기별 배치
    // 부스는 PC·노트북·태블릿으로만 운영합니다(휴대전화는 대상 아님).
    const viewports: { name: string; width: number; height: number; touch?: boolean; mobile?: boolean }[] = [
      { name: 'pc-1920', width: 1920, height: 1080 },
      { name: 'laptop-1536', width: 1536, height: 864 },
      { name: 'laptop-1366', width: 1366, height: 768 },
      { name: 'laptop-1280', width: 1280, height: 720 },
      { name: 'tablet-1180-land', width: 1180, height: 820, touch: true },
      { name: 'tablet-1024-land', width: 1024, height: 768, touch: true },
      { name: 'tablet-820-port', width: 820, height: 1180, touch: true },
      { name: 'tablet-768-port', width: 768, height: 1024, touch: true },
    ];
    for (const vp of viewports) {
      await test(`화면 배치 ${vp.name} (${vp.width}×${vp.height}): 넘침·잘림·가려짐 없음`, async () => {
        const { context, page } = await newPage(browser, { width: vp.width, height: vp.height, hasTouch: vp.touch, isMobile: vp.mobile });
        const issues: string[] = [];
        const check = async (label: string, sels: string[]) => {
          await sleep(350);
          const p = await layoutProblems(page, sels);
          issues.push(...p.map((x) => `[${label}] ${x}`));
          await shot(page, `${vp.name}-${label}`);
        };
        await login(page, env);
        await check('title', ['.title-start']);
        await page.click('.title-start');
        await waitScreen(page, 'topic');
        await check('topic', ['[data-topic="friends"]', '[data-topic="daily-luck"]']);
        await page.click('[data-topic="self-expression"]');
        await waitScreen(page, 'table');
        await page.waitForFunction(() => document.querySelectorAll('.table-card[aria-disabled="false"]').length === 15, null, { timeout: 15_000 });
        const tableIssues = await page.evaluate(() => {
          const spread = document.querySelector('.spread')!.getBoundingClientRect();
          const out: string[] = [];
          const cards = [...document.querySelectorAll<HTMLElement>('.table-card')].map((c) => c.getBoundingClientRect());
          cards.forEach((r, i) => {
            if (r.left < spread.left - 2 || r.right > spread.right + 2 || r.top < spread.top - 12 || r.bottom > spread.bottom + 14) out.push(`카드 ${i}가 테이블 밖`);
            if (r.width < 40) out.push(`카드 ${i}가 너무 작음(${Math.round(r.width)}px)`);
          });
          // 카드끼리 크게 겹치지 않음(선택하기 쉬움)
          for (let i = 0; i < cards.length; i++)
            for (let j = i + 1; j < cards.length; j++) {
              const a = cards[i]!;
              const b = cards[j]!;
              const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
              const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
              if (ix * iy > a.width * a.height * 0.25) out.push(`카드 ${i}·${j} 겹침`);
            }
          return out;
        });
        issues.push(...tableIssues.map((x) => `[table] ${x}`));
        await check('table', ['.table-actions .btn-primary', '.slots']);
        await pickThree(page, [0, 5, 10]);
        await check('table-picked', ['.table-actions .btn-primary']);
        await page.click('.table-actions .btn-primary');
        await waitScreen(page, 'reading', 10_000);
        await page.waitForFunction(() => document.querySelectorAll('.reading-card.is-flipped').length === 3, null, { timeout: 8_000 });
        await sleep(500);
        await check('reading', ['.reading-cards']);
        const readingSize = await page.evaluate(() => {
          const card = document.querySelector('.reading-card .flip-card')!.getBoundingClientRect();
          const names = [...document.querySelectorAll<HTMLElement>('.reading-card-name')].map((n) => ({ text: n.textContent, opacity: getComputedStyle(n).opacity }));
          return { w: card.width, names };
        });
        expect(readingSize.w >= (vp.width < 500 || vp.height < 500 ? 78 : 110), `해석 중 카드가 충분히 큼 (${Math.round(readingSize.w)}px)`);
        expect(readingSize.names.every((n) => n.opacity === '1' && (n.text ?? '').length > 2), '카드 이름·방향 표시');
        await waitScreen(page, 'card', 15_000);
        await sleep(600);
        await check('card', ['.detail-nav .btn-primary', '.detail-headline']);
        await page.click('.detail-nav .btn-primary');
        await sleep(700);
        await page.click('.detail-nav .btn-primary');
        await sleep(700);
        await page.click('.detail-nav .btn-primary');
        await waitScreen(page, 'summary');
        await check('summary', ['.summary-conclusion', '.summary-actions .btn-primary']);
        await page.click('.summary-actions .btn-primary');
        await page.waitForSelector('.name-dialog');
        await sleep(400);
        await check('name', ['.name-actions .btn-primary', '#print-name']);
        await page.fill('#print-name', '하늘');
        await page.click('.name-actions .btn-primary');
        await page.waitForSelector('.print-dialog');
        await sleep(400);
        await check('print', ['.print-actions .btn-primary']);
        const filtered = issues.filter((x) => !x.includes('자막에 가려짐: .summary-conclusion') && !x.includes('자막에 가려짐: .detail-headline'));
        if (filtered.length) throw new Error(filtered.join('\n      '));
        await context.close();
      });
    }

    await test('페이지 오류(콘솔 에러) 없음', async () => {
      expectEqual(pageErrors, [], '브라우저 콘솔 오류');
    });
  } finally {
    await browser.close();
    server.kill();
  }

  const passed = results.filter((r) => r.ok).length;
  const report = { date: new Date().toISOString(), browser: 'Microsoft Edge/Chrome (headless, playwright-core)', passed, failed: results.length - passed, results };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n결과: ${passed}/${results.length} 통과 — 자세한 내용 tests/e2e/output/report.json`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

