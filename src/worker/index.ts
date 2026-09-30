import { ReadingFormatError, validateReadingRequest, isRecord } from '../shared/reading.ts';
import type { ReadingResponse, SessionInfo } from '../shared/types.ts';
import {
  AuthConfigError,
  authConfigProblem,
  checkCredentials,
  clearSessionCookie,
  createSessionToken,
  getSession,
  sessionCookie,
  sessionTtlSeconds,
} from './auth.ts';
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
}

export function defaultDeps(): HandlerDeps {
  return {
    fetchImpl: (input, init) => fetch(input, init),
    loginFallback: new MemoryRateLimiter(5, 60_000),
    readingFallback: new MemoryRateLimiter(6, 60_000),
    lockout: new FailureLockout(),
    inFlight: new Set(),
    failureDelayMs: 400,
  };
}

type AiMode = SessionInfo['aiMode'];

function aiMode(env: Env, request: Request): AiMode {
  if (env.AI_MODE === 'mock') return isLocalHost(request) ? 'mock' : 'unconfigured';
  // 키가 없거나 잘린 값이면 타이틀 화면에 '연결 설정 필요'를 띄워 운영자가 미리 알 수 있게 합니다.
  return geminiKeyProblem(env.GEMINI_API_KEY) ? 'unconfigured' : 'gemini';
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createHandler(deps: HandlerDeps) {
  async function handleSession(request: Request, env: Env): Promise<Response> {
    const session = await getSession(env, request);
    const info: SessionInfo = session
      ? { authenticated: true, aiMode: aiMode(env, request), expiresAt: session.exp * 1000 }
      : { authenticated: false, aiMode: aiMode(env, request) };
    return json(info);
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
    const { token, session } = await createSessionToken(env);
    const info: SessionInfo = { authenticated: true, aiMode: aiMode(env, request), expiresAt: session.exp * 1000 };
    return json(info, 200, { 'Set-Cookie': sessionCookie(token, sessionTtlSeconds(env)) });
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
      if (path === '/api/logout') return handleLogout();

      if (path === '/api/reading') {
        const session = await getSession(env, request);
        if (!session) return apiError(401, 'unauthorized', '운영자 로그인이 필요합니다.');
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

const handle = createHandler(defaultDeps());

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
