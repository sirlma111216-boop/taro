import type { ApiError, ApiErrorCode } from '../shared/types.ts';

/** API 응답에 공통으로 붙이는 보안 헤더 (정적 파일 헤더는 public/_headers에서 설정) */
const API_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(API_HEADERS);
  for (const [k, v] of Object.entries(extraHeaders)) headers.append(k, v);
  return new Response(JSON.stringify(data), { status, headers });
}

export function apiError(
  status: number,
  error: ApiErrorCode,
  message: string,
  options: { retryAfterSeconds?: number; headers?: Record<string, string> } = {},
): Response {
  const body: ApiError = { error, message };
  const headers = { ...options.headers };
  if (options.retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = options.retryAfterSeconds;
    headers['Retry-After'] = String(options.retryAfterSeconds);
  }
  return json(body, status, headers);
}

export const MAX_BODY_BYTES = 4096;

export class BodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** JSON 본문을 크기 제한과 함께 읽습니다. */
export async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new BodyError(415, 'JSON 요청만 받을 수 있습니다.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new BodyError(413, '요청이 너무 큽니다.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new BodyError(413, '요청이 너무 큽니다.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError(400, 'JSON 형식이 올바르지 않습니다.');
  }
}

/**
 * CSRF 방어: 브라우저가 보낸 Origin이 있다면 같은 출처여야 합니다.
 * (세션 쿠키는 SameSite=Strict라 다른 사이트 요청에는 원래 붙지 않지만 한 번 더 확인)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) {
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    return fetchSite === null || fetchSite === 'same-origin' || fetchSite === 'none';
  }
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local';
}

export function isLocalHost(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}
