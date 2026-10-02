import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '../../src/worker/auth.ts';
import { hashPassword } from '../../src/worker/crypto.ts';
import type { Env, RateLimiter } from '../../src/worker/env.ts';
import type { FetchLike } from '../../src/worker/gemini.ts';
import { DAILY_CODE_TTL_MS, MemoryCodeStore } from '../../src/worker/daily-code.ts';
import { createHandler, type HandlerDeps } from '../../src/worker/index.ts';
import { FailureLockout, MemoryRateLimiter } from '../../src/worker/rate-limit.ts';
import { geminiResponse, validReading } from './fixtures.ts';

// 테스트 전용 계정 (실제 운영 비밀번호는 저장소에 넣지 않습니다)
const USER = 'test-operator';
const PASS = 'test-password-!23';
const ORIGIN = 'https://tarot.example.test';
const IDS = ['major-13', 'cups-03', 'pentacles-07'];

let baseEnv: Env;

beforeAll(async () => {
  baseEnv = {
    OPERATOR_USERNAME: USER,
    OPERATOR_PASSWORD_HASH: await hashPassword(PASS),
    SESSION_SECRET: 'unit-test-session-secret-0123456789-abcdef',
    GEMINI_API_KEY: 'test-gemini-key-0123456789abcdefghij',
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_THINKING_LEVEL: 'low',
    GEMINI_TIMEOUT_MS: '5000',
  };
});

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let deps: HandlerDeps;
let handle: ReturnType<typeof createHandler>;
let codeStore: MemoryCodeStore | null;
/** 일일 코드 기간 시험용 시계 (null이면 실제 시각) */
let clock: number | null;

function makeDeps(): HandlerDeps {
  return {
    fetchImpl: (input, init) => fetchMock(input, init),
    loginFallback: new MemoryRateLimiter(5, 60_000),
    readingFallback: new MemoryRateLimiter(6, 60_000),
    lockout: new FailureLockout(8, 15 * 60_000, 15 * 60_000),
    inFlight: new Set(),
    failureDelayMs: 0,
    codeStore: () => codeStore,
    now: () => clock ?? Date.now(),
  };
}

beforeEach(() => {
  fetchMock = vi.fn<FetchLike>();
  codeStore = new MemoryCodeStore();
  clock = null;
  deps = makeDeps();
  handle = createHandler(deps);
});

function post(path: string, body: unknown, headers: Record<string, string> = {}, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function login(env = baseEnv): Promise<string> {
  const res = await handle(post('/api/login', { username: USER, password: PASS }), env);
  expect(res.status).toBe(200);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

const readingBody = (overrides: Record<string, unknown> = {}) => ({
  topicId: 'friends',
  requestId: `req_${Math.random().toString(36).slice(2, 12)}`,
  cards: [
    { id: IDS[0], reversed: false },
    { id: IDS[1], reversed: true },
    { id: IDS[2], reversed: false },
  ],
  ...overrides,
});

function okGemini() {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(geminiResponse(JSON.stringify(validReading(IDS)))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('운영자 로그인', () => {
  it('비로그인 세션 조회', async () => {
    const res = await handle(new Request(`${ORIGIN}/api/session`), baseEnv);
    expect(await res.json()).toMatchObject({ authenticated: false, aiMode: 'gemini' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('틀린 비밀번호·틀린 아이디는 401', async () => {
    const r1 = await handle(post('/api/login', { username: USER, password: 'wrong' }), baseEnv);
    expect(r1.status).toBe(401);
    expect(r1.headers.get('Set-Cookie')).toBeNull();
    const r2 = await handle(post('/api/login', { username: 'someone', password: PASS }), baseEnv);
    expect(r2.status).toBe(401);
  });

  it('올바른 로그인은 HttpOnly·Secure·SameSite=Strict 세션 쿠키를 준다', async () => {
    const res = await handle(post('/api/login', { username: USER, password: PASS }), baseEnv);
    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^sl_session=v1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toMatch(/Max-Age=\d+/);
    expect(cookie).not.toContain(PASS);

    const session = await handle(new Request(`${ORIGIN}/api/session`, { headers: { Cookie: cookie.split(';')[0]! } }), baseEnv);
    expect(await session.json()).toMatchObject({ authenticated: true });
  });

  it('로그인 시도는 1분에 5번까지 (6번째는 429)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await handle(post('/api/login', { username: USER, password: 'wrong' }), baseEnv);
      expect(r.status).toBe(401);
    }
    const blocked = await handle(post('/api/login', { username: USER, password: PASS }), baseEnv);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('Cloudflare 바인딩이 거부하면 로그인도 거부한다', async () => {
    const deny: RateLimiter = { limit: async () => ({ success: false }) };
    const res = await handle(post('/api/login', { username: USER, password: PASS }), { ...baseEnv, LOGIN_LIMITER: deny });
    expect(res.status).toBe(429);
  });

  it('실패가 누적되면 잠금이 걸린다', async () => {
    deps.lockout = new FailureLockout(3, 60_000, 60_000);
    deps.loginFallback = new MemoryRateLimiter(100, 60_000);
    handle = createHandler(deps);
    for (let i = 0; i < 3; i++) await handle(post('/api/login', { username: USER, password: 'x' }), baseEnv);
    const res = await handle(post('/api/login', { username: USER, password: PASS }), baseEnv);
    expect(res.status).toBe(429);
  });

  it('다른 출처(Origin)에서 온 로그인 요청은 403', async () => {
    const res = await handle(post('/api/login', { username: USER, password: PASS }, {}, 'https://evil.example'), baseEnv);
    expect(res.status).toBe(403);
  });

  it('로그인 설정(해시·세션 비밀값)이 없으면 500과 설정 안내', async () => {
    const res = await handle(post('/api/login', { username: USER, password: PASS }), { ...baseEnv, OPERATOR_PASSWORD_HASH: undefined });
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'server_misconfigured' });
  });

  it('JSON이 아닌 요청과 너무 큰 요청은 거부', async () => {
    const r1 = await handle(post('/api/login', 'username=a', { 'Content-Type': 'application/x-www-form-urlencoded' }), baseEnv);
    expect(r1.status).toBe(415);
    const r2 = await handle(post('/api/login', { username: USER, password: 'x'.repeat(5000) }), baseEnv);
    expect(r2.status).toBe(413);
  });

  it('로그아웃하면 쿠키를 지운다', async () => {
    const cookie = await login();
    const res = await handle(post('/api/logout', {}, { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});

describe('일일 입장 코드', () => {
  const manage = (cookie: string, action: string, password = PASS) =>
    handle(post('/api/daily-code', { password, action }, cookie ? { Cookie: cookie } : {}), baseEnv);
  const codeLogin = (code: string, ip = '203.0.113.7') => handle(post('/api/login-code', { code }, { 'CF-Connecting-IP': ip }), baseEnv);
  const cookieOf = (res: Response) => (res.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const sessionOf = async (cookie: string) =>
    (await (await handle(new Request(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } }), baseEnv)).json()) as Record<string, unknown>;

  async function createCode(): Promise<{ code: string; createdAt: number; expiresAt: number }> {
    const res = await manage(await login(), 'create');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { code: { code: string; createdAt: number; expiresAt: number } };
    return data.code;
  }

  it('코드 관리는 운영자 로그인과 비밀번호 재확인이 모두 필요하다', async () => {
    expect((await manage('', 'create')).status).toBe(401);
    const cookie = await login();
    const wrong = await manage(cookie, 'create', 'wrong-password');
    expect(wrong.status).toBe(401);
    expect(await codeStore?.current()).toBeNull();
    expect((await manage(cookie, 'explode')).status).toBe(400);
  });

  it('만든 코드는 숫자 8자리이고 24시간 동안 쓸 수 있으며, 다시 열면 같은 코드가 보인다', async () => {
    const created = await createCode();
    expect(created.code).toMatch(/^\d{8}$/);
    expect(created.expiresAt - created.createdAt).toBe(DAILY_CODE_TTL_MS);
    const view = await manage(await login(), 'view');
    expect(((await view.json()) as { code: unknown }).code).toEqual(created);
  });

  it('코드로 입장하면 code 세션이 열리고 AI 해석을 받을 수 있다', async () => {
    const { code } = await createCode();
    const res = await codeLogin(`${code.slice(0, 4)} ${code.slice(4)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authenticated: true, role: 'code' });
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^sl_session=v1\./);
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(await sessionOf(cookie)).toMatchObject({ authenticated: true, role: 'code' });
    okGemini();
    const reading = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(reading.status).toBe(200);
  });

  it('하이픈·전각 숫자도 받아들이고, 틀린 코드는 401이며 쿠키를 주지 않는다', async () => {
    const { code } = await createCode();
    const fullWidth = [...code].map((d) => String.fromCharCode(0xff10 + Number(d))).join('');
    expect((await codeLogin(fullWidth)).status).toBe(200);
    expect((await codeLogin(`${code.slice(0, 4)}-${code.slice(4)}`)).status).toBe(200);
    const wrongCode = code === '12345678' ? '87654321' : '12345678';
    const wrong = await codeLogin(wrongCode);
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_code');
    expect(wrong.headers.get('Set-Cookie')).toBeNull();
    expect((await codeLogin('abc')).status).toBe(401);
    expect((await codeLogin('')).status).toBe(400);
  });

  it('코드가 없으면 입장할 수 없다', async () => {
    expect((await codeLogin('12345678')).status).toBe(401);
  });

  it('코드로 들어온 기기는 코드를 볼 수도, 새로 만들 수도 없다', async () => {
    const { code } = await createCode();
    const cookie = cookieOf(await codeLogin(code));
    const res = await manage(cookie, 'view');
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(code);
  });

  it('새 코드를 만들면 이전 코드와, 이전 코드로 들어온 기기의 로그인이 끝난다', async () => {
    const first = await createCode();
    const oldCookie = cookieOf(await codeLogin(first.code));
    const second = await createCode();
    expect(second.code === first.code && second.createdAt === first.createdAt).toBe(false);
    expect(await sessionOf(oldCookie)).toMatchObject({ authenticated: false });
    const reading = await handle(post('/api/reading', readingBody(), { Cookie: oldCookie }), baseEnv);
    expect(reading.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    if (first.code !== second.code) expect((await codeLogin(first.code)).status).toBe(401);
    expect((await codeLogin(second.code)).status).toBe(200);
  });

  it('코드를 끄면 더 이상 입장할 수 없다', async () => {
    const { code } = await createCode();
    const cookie = cookieOf(await codeLogin(code));
    const res = await manage(await login(), 'clear');
    expect(await res.json()).toEqual({ code: null });
    expect((await codeLogin(code)).status).toBe(401);
    expect(await sessionOf(cookie)).toMatchObject({ authenticated: false });
  });

  it('24시간이 지나면 코드와 그 코드로 열린 세션이 끝나고, 세션은 코드 기간을 넘지 않는다', async () => {
    const t0 = Date.now();
    clock = t0;
    const { code, expiresAt } = await createCode();
    clock = t0 + 20 * 3600_000;
    const res = await codeLogin(code);
    expect(res.status).toBe(200);
    const info = (await res.json()) as { expiresAt: number };
    expect(info.expiresAt).toBeLessThanOrEqual(expiresAt);
    const maxAge = Number(/Max-Age=(\d+)/.exec(res.headers.get('Set-Cookie') ?? '')?.[1]);
    expect(maxAge).toBeLessThanOrEqual(4 * 3600);
    clock = expiresAt + 1000;
    expect((await codeLogin(code)).status).toBe(401);
  });

  it('틀린 코드를 여러 번 넣으면 코드 입장만 잠기고 운영자 로그인은 그대로 된다', async () => {
    await createCode();
    const ip = '198.51.100.20';
    deps.loginFallback = new MemoryRateLimiter(100, 60_000);
    handle = createHandler(deps);
    for (let i = 0; i < 8; i++) await codeLogin('00000000', ip);
    const locked = await codeLogin('00000000', ip);
    expect(locked.status).toBe(429);
    const op = await handle(post('/api/login', { username: USER, password: PASS }, { 'CF-Connecting-IP': ip }), baseEnv);
    expect(op.status).toBe(200);
  });

  it('저장소 바인딩이 없으면 설정이 필요하다고 알린다', async () => {
    codeStore = null;
    const res = await codeLogin('12345678');
    expect(res.status).toBe(503);
  });
});

describe('AI 해석 API 보호', () => {
  it('로그인하지 않은 요청은 401이고 Gemini를 호출하지 않는다', async () => {
    const res = await handle(post('/api/reading', readingBody()), baseEnv);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('위조·만료된 쿠키는 401', async () => {
    const res1 = await handle(post('/api/reading', readingBody(), { Cookie: 'sl_session=v1.fake.fake' }), baseEnv);
    expect(res1.status).toBe(401);
    const { token } = await createSessionToken({ ...baseEnv, SESSION_TTL_HOURS: '1' }, Date.now() - 2 * 3600_000);
    const res2 = await handle(post('/api/reading', readingBody(), { Cookie: `sl_session=${token}` }), baseEnv);
    expect(res2.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET 등 다른 메서드는 거부', async () => {
    const res = await handle(new Request(`${ORIGIN}/api/reading`), baseEnv);
    expect(res.status).toBe(405);
  });
});

describe('Gemini 해석', () => {
  it('서버 카드 데이터로 요청을 만들고, 검증된 결과를 순서대로 돌려준다', async () => {
    okGemini();
    const cookie = await login();
    const body = readingBody();
    // 클라이언트가 임의의 카드 설명·성별을 보내도 무시되어야 함
    (body.cards as Record<string, unknown>[])[0]!.nameKo = '클라이언트가 조작한 이름';
    (body as Record<string, unknown>).gender = 'girl';
    const res = await handle(post('/api/reading', body, { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { source: string; model: string; reading: { cards: { cardId: string }[] } };
    expect(data.source).toBe('gemini');
    expect(data.model).toBe('gemini-3.8-flash');
    expect(data.reading.cards.map((c) => c.cardId)).toEqual(IDS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe('test-gemini-key-0123456789abcdefghij');
    const sent = JSON.parse(String(init.body)) as Record<string, any>;
    expect(sent.store).toBe(false);
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(sent.generationConfig.temperature).toBeUndefined();
    expect(sent.generationConfig.responseFormat.text.mimeType).toBe('APPLICATION_JSON');
    expect(sent.generationConfig.responseFormat.text.schema.properties.cards.items.properties.cardId.enum).toEqual(IDS);
    const prompt: string = sent.contents[0].parts[0].text;
    expect(prompt).toContain('죽음 (Death)');
    expect(prompt).toContain('컵 3 (Three of Cups) / 방향: 역방향');
    expect(prompt).toContain('지금의 나');
    expect(prompt).toContain('친구와의 거리');
    expect(prompt).not.toContain('클라이언트가 조작한 이름');
    expect(prompt).not.toMatch(/여학생|남학생|girl/);
    expect(sent.systemInstruction.parts[0].text).toContain('예언하거나');
  });

  it('붙여넣기 사고로 잘린 키(제어 문자 한 글자)는 호출하지 않고 설정 필요로 알린다', async () => {
    const env = { ...baseEnv, GEMINI_API_KEY: '\u0016' };
    const session = await handle(new Request(`${ORIGIN}/api/session`), env);
    expect(await session.json()).toMatchObject({ aiMode: 'unconfigured' });
    const cookie = await login(env);
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'ai_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('API 키가 없으면 503 ai_not_configured (가짜 결과를 만들지 않음)', async () => {
    const env = { ...baseEnv, GEMINI_API_KEY: '' };
    const cookie = await login(env);
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'ai_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [500, 502, 'ai_upstream_error'],
    [503, 502, 'ai_upstream_error'],
    [429, 429, 'rate_limited'],
    [403, 503, 'ai_not_configured'],
    [404, 503, 'ai_not_configured'],
    [400, 502, 'ai_upstream_error'],
  ])('Gemini HTTP %i → %i %s', async (upstream, status, code) => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"details with prompt"}}', { status: upstream }));
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(status);
    const data = (await res.json()) as { error: string; message: string };
    expect(data.error).toBe(code);
    expect(data.message).not.toContain('details with prompt');
  });

  it('지역 제한(400 FAILED_PRECONDITION)은 지역 설정 안내로 구분한다', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }), { status: 400 }),
    );
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(503);
    const data = (await res.json()) as { error: string; message: string };
    expect(data.error).toBe('ai_not_configured');
    expect(data.message).toContain('서버 위치');
  });

  it('잘못된 API 키(400 API_KEY_INVALID)는 키 확인 안내', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }),
    );
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain('API 키');
  });

  it('잘못된 JSON 응답은 502 ai_bad_response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(geminiResponse('{"cards": [')), { status: 200 }));
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ai_bad_response' });
  });

  it('길이 제한으로 잘린 응답(MAX_TOKENS)도 오류로 처리', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(geminiResponse(JSON.stringify(validReading(IDS)), 'MAX_TOKENS')), { status: 200 }));
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(502);
  });

  it('안전 정책 차단은 502 ai_blocked', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
    const cookie = await login();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(await res.json()).toMatchObject({ error: 'ai_blocked' });
  });

  it('응답이 제한 시간을 넘기면 504 ai_timeout', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const cookie = await login();
    const started = Date.now();
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(res.status).toBe(504);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
  });

  it('처리 중인 같은 요청 ID가 다시 오면 409 (중복 요청 방지)', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
    const cookie = await login();
    const body = readingBody();
    const first = handle(post('/api/reading', body, { Cookie: cookie }), baseEnv);
    await new Promise((r) => setTimeout(r, 20));
    const second = await handle(post('/api/reading', body, { Cookie: cookie }), baseEnv);
    expect(second.status).toBe(409);
    release(new Response(JSON.stringify(geminiResponse(JSON.stringify(validReading(IDS)))), { status: 200 }));
    expect((await first).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('세션별 해석 요청은 1분에 6번까지', async () => {
    okGemini();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(geminiResponse(JSON.stringify(validReading(IDS)))), { status: 200 }));
    const cookie = await login();
    for (let i = 0; i < 6; i++) {
      const r = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
      expect(r.status).toBe(200);
    }
    const r7 = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), baseEnv);
    expect(r7.status).toBe(429);
  });

  it('잘못된 카드 요청은 Gemini 호출 전에 400', async () => {
    const cookie = await login();
    const res = await handle(
      post('/api/reading', readingBody({ cards: [{ id: 'major-13', reversed: false }, { id: 'major-13', reversed: true }, { id: 'cups-01', reversed: false }] }), { Cookie: cookie }),
      baseEnv,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('테스트용 모의 응답(mock)', () => {
  it('localhost에서만 동작하고 source=mock으로 표시된다', async () => {
    const env = { ...baseEnv, AI_MODE: 'mock', GEMINI_API_KEY: '' };
    const local = 'http://localhost:5173';
    const loginRes = await handle(
      new Request(`${local}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: local },
        body: JSON.stringify({ username: USER, password: PASS }),
      }),
      env,
    );
    const cookie = (loginRes.headers.get('Set-Cookie') ?? '').split(';')[0]!;
    const res = await handle(
      new Request(`${local}/api/reading`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: local, Cookie: cookie },
        body: JSON.stringify(readingBody()),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { source: string; reading: { summary: { title: string } } };
    expect(data.source).toBe('mock');
    expect(data.reading.summary.title).toContain('[모의]');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('배포 주소에서 AI_MODE=mock이면 가짜 결과 대신 503', async () => {
    const env = { ...baseEnv, AI_MODE: 'mock' };
    const cookie = await login(env);
    const res = await handle(post('/api/reading', readingBody(), { Cookie: cookie }), env);
    expect(res.status).toBe(503);
    const session = await handle(new Request(`${ORIGIN}/api/session`), env);
    expect(await session.json()).toMatchObject({ aiMode: 'unconfigured' });
  });
});
