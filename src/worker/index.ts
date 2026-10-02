import { ReadingFormatError, validateReadingRequest, isRecord } from '../shared/reading.ts';
import type { DailyCodeAction, DailyCodeInfo, ReadingResponse, SessionInfo } from '../shared/types.ts';
import {
  AuthConfigError,
  authConfigProblem,
  checkCredentials,
  checkOperatorPassword,
  clearSessionCookie,
  createSessionToken,
  getSession,
  sessionCookie,
  type Session,
} from './auth.ts';
import { codeMatches, durableCodeStore, newDailyCode, toInfo, type CodeStore } from './daily-code.ts';
import { PasswordHashFormatError } from './crypto.ts';
import { numberVar, type Env, type RateLimiter } from './env.ts';
import { generateReading, geminiConfig, GeminiError, geminiKeyProblem, type FetchLike } from './gemini.ts';
import { apiError, BodyError, clientIp, isLocalHost, isSameOrigin, json, readJson } from './http.ts';
import { parseScenario, runMockScenario } from './mock.ts';
import { checkLimit, FailureLockout, MemoryRateLimiter } from './rate-limit.ts';

export interface HandlerDeps {
  fetchImpl: FetchLike;
  loginFallback: RateLimiter;
  readingFallback: RateLimiter;
  lockout: FailureLockout;
  inFlight: Set<string>;
  /** 로그인 실패 응답을 조금 늦춰 무차별 대입을 어렵게 합니다(테스트에서는 0). */
  failureDelayMs: number;
  /** 일일 코드 저장소. 바인딩(DAILY_CODE)이 없으면 null → 코드 기능을 쓸 수 없다고 알립니다. */
  codeStore: (env: Env) => CodeStore | null;
  now: () => number;
}

export function defaultDeps(): HandlerDeps {
  return {
    fetchImpl: (input, init) => fetch(input, init),
    loginFallback: new MemoryRateLimiter(5, 60_000),
    readingFallback: new MemoryRateLimiter(6, 60_000),
    lockout: new FailureLockout(),
    inFlight: new Set(),
    failureDelayMs: 400,
    codeStore: (env) => (env.DAILY_CODE ? durableCodeStore(env.DAILY_CODE) : null),
    now: () => Date.now(),
  };
}

const DAILY_CODE_ACTIONS: readonly DailyCodeAction[] = ['view', 'create', 'clear'];

type AiMode = SessionInfo['aiMode'];

function aiMode(env: Env, request: Request): AiMode {
  if (env.AI_MODE === 'mock') return isLocalHost(request) ? 'mock' : 'unconfigured';
  // 키가 없거나 잘린 값이면 타이틀 화면에 '연결 설정 필요'를 띄워 운영자가 미리 알 수 있게 합니다.
  return geminiKeyProblem(env.GEMINI_API_KEY) ? 'unconfigured' : 'gemini';
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sessionInfo(env: Env, request: Request, session: Session): SessionInfo {
  return { authenticated: true, aiMode: aiMode(env, request), expiresAt: session.exp * 1000, role: session.role };
}

export function createHandler(deps: HandlerDeps) {
  /**
   * 쿠키 서명·기간을 확인하고, 일일 코드로 들어온 세션은 그 코드가 아직 살아 있는지도 확인합니다.
   * (관리자가 코드를 새로 만들거나 끄면 이전 코드로 들어온 기기는 다시 입장해야 합니다)
   */
  async function authenticate(request: Request, env: Env): Promise<Session | null> {
    const now = deps.now();
    const session = await getSession(env, request, now);
    if (!session || session.role === 'operator') return session;
    const store = deps.codeStore(env);
    if (!store) return null;
    const record = await store.current();
    return record && record.id === session.cid && record.expiresAt > now ? session : null;
  }

  async function handleSession(request: Request, env: Env): Promise<Response> {
    const session = await authenticate(request, env);
    const info: SessionInfo = session ? sessionInfo(env, request, session) : { authenticated: false, aiMode: aiMode(env, request) };
    return json(info);
  }

  function issueSession(env: Env, request: Request, token: string, session: Session): Response {
    const maxAge = Math.max(1, session.exp - Math.floor(deps.now() / 1000));
    return json(sessionInfo(env, request, session), 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
  }

  // LOGIN_LIMIT_PER_MINUTE(3~60)로 인스턴스 메모리 제한을 바꿀 수 있습니다. 기본 5회.
  const loginLimiters = new Map<number, RateLimiter>();
  function loginFallbackFor(env: Env): RateLimiter {
    if (!env.LOGIN_LIMIT_PER_MINUTE) return deps.loginFallback;
    const limit = Math.round(numberVar(env.LOGIN_LIMIT_PER_MINUTE, 5, 3, 60));
    let limiter = loginLimiters.get(limit);
    if (!limiter) {
      limiter = new MemoryRateLimiter(limit, 60_000);
      loginLimiters.set(limit, limiter);
    }
    return limiter;
  }

  async function handleLogin(request: Request, env: Env): Promise<Response> {
    const ip = clientIp(request);
    const locked = deps.lockout.lockedFor(ip);
    if (locked > 0) {
      return apiError(429, 'rate_limited', '로그인 실패가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.', {
        retryAfterSeconds: locked,
      });
    }
    if (!(await checkLimit(env.LOGIN_LIMITER, loginFallbackFor(env), `login:${ip}`))) {
      return apiError(429, 'rate_limited', '로그인 시도가 너무 많습니다. 1분 뒤 다시 시도해 주세요.', {
        retryAfterSeconds: 60,
      });
    }

    const body = await readJson(request);
    if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return apiError(400, 'bad_request', '아이디와 비밀번호를 입력해 주세요.');
    }
    const username = body.username.trim().slice(0, 64);
    const password = body.password.slice(0, 256);

    const problem = authConfigProblem(env);
    if (problem) {
      return apiError(500, 'server_misconfigured', `운영자 로그인 설정이 필요합니다: ${problem}`);
    }

    let ok = false;
    try {
      ok = await checkCredentials(env, username, password);
    } catch (error) {
      if (error instanceof AuthConfigError || error instanceof PasswordHashFormatError) {
        return apiError(500, 'server_misconfigured', `운영자 로그인 설정을 확인해 주세요: ${error.message}`);
      }
      throw error;
    }

    if (!ok) {
      deps.lockout.recordFailure(ip);
      if (deps.failureDelayMs > 0) await delay(deps.failureDelayMs);
      return apiError(401, 'invalid_credentials', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }

    deps.lockout.recordSuccess(ip);
    const { token, session } = await createSessionToken(env, deps.now());
    return issueSession(env, request, token, session);
  }

  /** 일일 코드로 입장: 운영자 비밀번호 없이, 코드의 사용 기간 안에서만 세션을 엽니다. */
  async function handleCodeLogin(request: Request, env: Env): Promise<Response> {
    const ip = clientIp(request);
    const lockKey = `code:${ip}`;
    const locked = deps.lockout.lockedFor(lockKey);
    if (locked > 0) {
      return apiError(429, 'rate_limited', '코드를 여러 번 잘못 입력해 잠시 잠겼어요. 잠시 후 다시 시도해 주세요.', {
        retryAfterSeconds: locked,
      });
    }
    if (!(await checkLimit(env.LOGIN_LIMITER, loginFallbackFor(env), lockKey))) {
      return apiError(429, 'rate_limited', '입장 시도가 너무 많아요. 1분 뒤 다시 시도해 주세요.', { retryAfterSeconds: 60 });
    }

    const body = await readJson(request);
    if (!isRecord(body) || typeof body.code !== 'string' || !body.code.trim()) {
      return apiError(400, 'bad_request', '입장 코드를 입력해 주세요.');
    }
    const problem = authConfigProblem(env);
    if (problem) return apiError(500, 'server_misconfigured', `로그인 설정이 필요합니다: ${problem}`);
    const store = deps.codeStore(env);
    if (!store) return apiError(503, 'server_misconfigured', '일일 코드 저장소(DAILY_CODE) 설정이 필요합니다.');

    const now = deps.now();
    const record = await store.current();
    if (!record || !(await codeMatches(record, body.code.slice(0, 32), now))) {
      deps.lockout.recordFailure(lockKey);
      if (deps.failureDelayMs > 0) await delay(deps.failureDelayMs);
      return apiError(401, 'invalid_code', '입장 코드가 맞지 않거나 사용 기간이 끝났어요. 관리자에게 확인해 주세요.');
    }

    deps.lockout.recordSuccess(lockKey);
    const { token, session } = await createSessionToken(env, now, { role: 'code', codeId: record.id, notAfter: record.expiresAt });
    return issueSession(env, request, token, session);
  }

  /**
   * 일일 코드 관리(보기·만들기·끄기): 운영자로 로그인한 세션 + 운영자 비밀번호 재확인이 모두 필요합니다.
   * 부스 기기가 운영자로 로그인된 채 학생이 써도 코드를 볼 수 없게 하기 위해서입니다.
   */
  async function handleDailyCode(request: Request, env: Env): Promise<Response> {
    const session = await authenticate(request, env);
    if (!session) return apiError(401, 'unauthorized', '운영자 로그인이 필요합니다.');
    if (session.role !== 'operator') return apiError(403, 'forbidden', '일일 코드는 운영자 계정으로만 관리할 수 있습니다.');

    const ip = clientIp(request);
    const locked = deps.lockout.lockedFor(ip);
    if (locked > 0) {
      return apiError(429, 'rate_limited', '비밀번호 실패가 많아 잠시 잠겼습니다. 잠시 후 다시 시도해 주세요.', {
        retryAfterSeconds: locked,
      });
    }
    if (!(await checkLimit(env.LOGIN_LIMITER, loginFallbackFor(env), `admin:${ip}`))) {
      return apiError(429, 'rate_limited', '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.', { retryAfterSeconds: 60 });
    }

    const body = await readJson(request);
    if (!isRecord(body) || typeof body.password !== 'string' || !DAILY_CODE_ACTIONS.includes(body.action as DailyCodeAction)) {
      return apiError(400, 'bad_request', '운영자 비밀번호를 입력해 주세요.');
    }
    const action = body.action as DailyCodeAction;
    const store = deps.codeStore(env);
    if (!store) return apiError(503, 'server_misconfigured', '일일 코드 저장소(DAILY_CODE) 설정이 필요합니다.');

    let ok = false;
    try {
      ok = await checkOperatorPassword(env, body.password.slice(0, 256));
    } catch (error) {
      if (error instanceof AuthConfigError || error instanceof PasswordHashFormatError) {
        return apiError(500, 'server_misconfigured', `운영자 로그인 설정을 확인해 주세요: ${error.message}`);
      }
      throw error;
    }
    if (!ok) {
      deps.lockout.recordFailure(ip);
      if (deps.failureDelayMs > 0) await delay(deps.failureDelayMs);
      return apiError(401, 'invalid_credentials', '비밀번호가 올바르지 않습니다.');
    }
    deps.lockout.recordSuccess(ip);

    const now = deps.now();
    let code: DailyCodeInfo | null;
    if (action === 'create') {
      const record = newDailyCode(now);
      await store.replace(record);
      code = toInfo(record, now);
    } else if (action === 'clear') {
      await store.clear();
      code = null;
    } else {
      code = toInfo(await store.current(), now);
    }
    return json({ code });
  }

  function handleLogout(): Response {
    return json({ authenticated: false }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  async function handleReading(request: Request, env: Env, sid: string): Promise<Response> {
    const body = await readJson(request);
    const validated = validateReadingRequest(body);
    if (!validated.ok) return apiError(400, 'bad_request', validated.message);
    const readingRequest = validated.value;

    if (!(await checkLimit(env.READING_LIMITER, deps.readingFallback, `reading:${sid}`))) {
      return apiError(429, 'rate_limited', '해석 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', {
        retryAfterSeconds: 30,
      });
    }

    const flightKey = `${sid}:${readingRequest.requestId}`;
    if (deps.inFlight.has(flightKey)) {
      return apiError(409, 'duplicate_request', '같은 해석 요청이 이미 처리 중입니다.');
    }
    deps.inFlight.add(flightKey);

    try {
      const mode = aiMode(env, request);
      if (mode === 'mock') {
        const scenario = parseScenario(request.headers.get('X-Mock-Scenario'));
        const reading = await runMockScenario(readingRequest, scenario, request.signal);
        const response: ReadingResponse = { reading, source: 'mock', model: 'mock' };
        return json(response);
      }
      if (env.AI_MODE === 'mock') {
        // mock 설정이 배포 주소에서 켜져 있으면 가짜 결과를 내보내지 않고 설정 오류로 알립니다.
        return apiError(503, 'ai_not_configured', 'AI_MODE=mock은 로컬(localhost)에서만 쓸 수 있습니다. AI_MODE를 gemini로 바꿔 주세요.');
      }
      const config = geminiConfig(env);
      if (!config) {
        return apiError(503, 'ai_not_configured', 'AI 해석 연결 설정이 필요합니다. 운영자는 GEMINI_API_KEY를 설정해 주세요.');
      }
      const reading = await generateReading(readingRequest, config, deps.fetchImpl);
      const response: ReadingResponse = { reading, source: 'gemini', model: config.model };
      return json(response);
    } catch (error) {
      return readingErrorResponse(error);
    } finally {
      deps.inFlight.delete(flightKey);
    }
  }

  return async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return apiError(404, 'not_found', '찾을 수 없는 주소입니다.');

    try {
      if (path === '/api/session' && request.method === 'GET') return await handleSession(request, env);

      if (request.method !== 'POST') return apiError(405, 'bad_request', '허용되지 않는 요청 방식입니다.');
      if (!isSameOrigin(request)) return apiError(403, 'forbidden', '다른 출처의 요청은 받을 수 없습니다.');

      if (path === '/api/login') return await handleLogin(request, env);
      if (path === '/api/login-code') return await handleCodeLogin(request, env);
      if (path === '/api/logout') return handleLogout();
      if (path === '/api/daily-code') return await handleDailyCode(request, env);

      if (path === '/api/reading') {
        const session = await authenticate(request, env);
        if (!session) return apiError(401, 'unauthorized', '로그인 시간이 끝났습니다. 다시 로그인해 주세요.');
        return await handleReading(request, env, session.sid);
      }
      return apiError(404, 'not_found', '찾을 수 없는 API입니다.');
    } catch (error) {
      if (error instanceof BodyError) {
        return apiError(error.status, 'bad_request', error.message);
      }
      // 요청 본문·결과는 기록하지 않고 오류 종류만 남깁니다.
      console.error('api_error', path, error instanceof Error ? error.name : 'unknown');
      return apiError(500, 'server_misconfigured', '서버에서 문제가 발생했습니다.');
    }
  };
}

export function readingErrorResponse(error: unknown): Response {
  if (error instanceof ReadingFormatError) {
    return apiError(502, 'ai_bad_response', 'AI 응답 형식이 올바르지 않아 결과를 보여 줄 수 없습니다. 다시 시도해 주세요.');
  }
  if (error instanceof GeminiError) {
    console.warn('gemini_error', error.kind, error.status ?? '-');
    switch (error.kind) {
      case 'timeout':
        return apiError(504, 'ai_timeout', 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.');
      case 'blocked':
        return apiError(502, 'ai_blocked', 'AI가 이번 해석을 만들지 못했습니다. 다시 시도해 주세요.');
      case 'bad_response':
        return apiError(502, 'ai_bad_response', 'AI 응답 형식이 올바르지 않아 결과를 보여 줄 수 없습니다. 다시 시도해 주세요.');
      case 'quota':
        return apiError(429, 'rate_limited', 'AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', {
          retryAfterSeconds: error.retryAfterSeconds ?? 30,
        });
      case 'auth':
        return apiError(503, 'ai_not_configured', 'Gemini API 키 또는 권한을 확인해야 합니다. 운영자에게 알려 주세요.');
      case 'model':
        return apiError(503, 'ai_not_configured', 'Gemini 모델 설정(GEMINI_MODEL)을 확인해야 합니다. 운영자에게 알려 주세요.');
      case 'region':
        return apiError(
          503,
          'ai_not_configured',
          '현재 서버 위치에서는 Gemini API를 쓸 수 없습니다. 운영자는 wrangler.jsonc의 placement 설정(서울 지역 고정)을 확인해 주세요.',
        );
      default:
        return apiError(502, 'ai_upstream_error', 'AI 서버와 연결이 원활하지 않습니다. 다시 시도해 주세요.');
    }
  }
  console.error('reading_error', error instanceof Error ? error.name : 'unknown');
  return apiError(500, 'server_misconfigured', '해석 중 서버 문제가 발생했습니다.');
}

// Durable Object 클래스는 Worker 진입 파일에서 내보내야 합니다(wrangler.jsonc durable_objects).
export { DailyCodeStore } from './daily-code-store.ts';

const handle = createHandler(defaultDeps());

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
