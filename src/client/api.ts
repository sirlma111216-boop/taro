import { isReading } from '../shared/reading.ts';
import type { ApiError, ApiErrorCode, ReadingRequest, ReadingResponse, SessionInfo } from '../shared/types.ts';

/*
 * 같은 출처의 서버 API만 호출합니다. 브라우저에는 API 키나 비밀번호 해시가 없습니다.
 */

export type ClientErrorCode = ApiErrorCode | 'network' | 'client_timeout' | 'aborted';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: ClientErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 해석 요청의 브라우저 쪽 제한 시간 (서버의 Gemini 제한 시간 35초보다 조금 길게) */
export const CLIENT_READING_TIMEOUT_MS = 45_000;

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const outer = init.signal;
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer =
    init.timeoutMs !== undefined
      ? window.setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, init.timeoutMs)
      : undefined;

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    if (timedOut) throw new ApiRequestError(0, 'client_timeout', '응답을 기다리는 시간이 초과되었습니다.');
    if (controller.signal.aborted) throw new ApiRequestError(0, 'aborted', '요청이 취소되었습니다.');
    throw new ApiRequestError(0, 'network', '인터넷 연결을 확인해 주세요.');
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    if (controller.signal.aborted) throw new ApiRequestError(0, 'aborted', '요청이 취소되었습니다.');
  }
  if (!response.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      response.status,
      err.error ?? 'ai_upstream_error',
      err.message ?? `서버 오류 (${response.status})`,
      err.retryAfterSeconds,
    );
  }
  return data as T;
}

export const api = {
  session(): Promise<SessionInfo> {
    return request<SessionInfo>('/api/session', { method: 'GET', timeoutMs: 15_000 });
  },

  login(username: string, password: string): Promise<SessionInfo> {
    return request<SessionInfo>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      timeoutMs: 20_000,
    });
  },

  logout(): Promise<unknown> {
    return request('/api/logout', { method: 'POST', body: '{}', timeoutMs: 15_000 });
  },

  async reading(
    body: ReadingRequest,
    options: { signal: AbortSignal; timeoutMs?: number; mockScenario?: string | null },
  ): Promise<ReadingResponse> {
    const headers: Record<string, string> = {};
    if (options.mockScenario) headers['X-Mock-Scenario'] = options.mockScenario;
    const data = await request<ReadingResponse>('/api/reading', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? CLIENT_READING_TIMEOUT_MS,
      headers,
    });
    // 서버가 검증했지만, 화면에 쓰기 전에 카드 ID·순서를 한 번 더 확인합니다.
    const ids = body.cards.map((c) => c.id);
    if (!data || !isReading(data.reading, ids) || data.reading.cards.some((c, i) => c.cardId !== ids[i])) {
      throw new ApiRequestError(502, 'ai_bad_response', '해석 결과 형식이 올바르지 않습니다.');
    }
    return data;
  },
};
