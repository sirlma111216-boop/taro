import { buildReadingSchema, parseReading, ReadingFormatError, isRecord } from '../shared/reading.ts';
import type { Reading, ReadingRequest } from '../shared/types.ts';
import { DEFAULT_MODEL, DEFAULT_THINKING_LEVEL, DEFAULT_TIMEOUT_MS, numberVar, type Env } from './env.ts';
import { buildUserPrompt, SYSTEM_INSTRUCTION } from './prompt.ts';

/*
 * Gemini API 호출 (REST, generateContent)
 * 공식 문서 기준(2026-09):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *   헤더 x-goog-api-key, generationConfig.responseFormat.text = { mimeType, schema }
 *   generationConfig.thinkingConfig.thinkingLevel, 요청 단위 store=false
 * generateContent는 문서상 운영 환경에 권장되는 안정 API이며 기본적으로 요청을 저장하지 않습니다.
 * 여기서는 store:false를 명시해 프로젝트 로그 설정과 상관없이 이 요청을 로그에 남기지 않도록 요청합니다.
 * (Google의 약관에 따른 남용 모니터링 등 제공자 측 처리까지 없앤다는 뜻은 아닙니다.)
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]{1,62}$/;
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high']);
/** thinking 토큰까지 포함하는 상한. 결과가 잘리지 않을 만큼 넉넉히 둡니다. */
export const MAX_OUTPUT_TOKENS = 8192;

export type GeminiErrorKind = 'timeout' | 'blocked' | 'bad_response' | 'quota' | 'auth' | 'model' | 'region' | 'upstream';

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(kind: GeminiErrorKind, message: string, status?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  thinkingLevel: string | null;
  timeoutMs: number;
}

/**
 * API 키 모양 점검: 비었거나, 너무 짧거나(붙여넣기 사고로 잘린 값), 공백·제어 문자가 섞였는지.
 * 제어 문자가 섞인 키는 HTTP 헤더로 보낼 수조차 없어 '연결 실패'로 보이므로 미리 걸러 냅니다.
 */
export function geminiKeyProblem(key: string | undefined): string | null {
  const value = key?.trim() ?? '';
  if (!value) return 'GEMINI_API_KEY가 설정되지 않았습니다.';
  if (/[\s\u0000-\u001f\u007f]/.test(value) || value.length < 20) {
    return 'GEMINI_API_KEY 값이 잘렸거나 올바르지 않습니다. npm run secrets:upload -- GEMINI_API_KEY 로 다시 등록해 주세요.';
  }
  return null;
}

export function geminiConfig(env: Env): GeminiConfig | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const keyProblem = geminiKeyProblem(apiKey);
  if (keyProblem) throw new GeminiError('auth', keyProblem);
  const model = (env.GEMINI_MODEL?.trim() || DEFAULT_MODEL).toLowerCase();
  if (!MODEL_PATTERN.test(model)) throw new GeminiError('model', 'GEMINI_MODEL 값이 올바르지 않습니다.');
  const level = (env.GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL).trim().toLowerCase();
  return {
    apiKey,
    model,
    // 빈 값이면 thinkingConfig를 보내지 않고 모델 기본값을 씁니다.
    thinkingLevel: level && THINKING_LEVELS.has(level) ? level : null,
    timeoutMs: numberVar(env.GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 90_000),
  };
}

export function buildRequestBody(request: ReadingRequest, config: Pick<GeminiConfig, 'thinkingLevel'>): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseFormat: {
      text: {
        // REST에서는 enum 이름을 써야 합니다(API 레퍼런스: MimeType = APPLICATION_JSON).
        // 문서 예제의 "application/json"은 400 INVALID_ARGUMENT로 거부됩니다(2026-09-30 확인).
        mimeType: 'APPLICATION_JSON',
        schema: buildReadingSchema(request.cards.map((c) => c.id)),
      },
    },
  };
  if (config.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(request) }] }],
    generationConfig,
    store: false,
  };
}

const BLOCK_FINISH_REASONS = new Set([
  'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE', 'ESCALATION',
]);

/** generateContent 응답에서 최종 텍스트(생각 부분 제외)를 꺼냅니다. */
export function extractText(data: unknown): string {
  if (!isRecord(data)) throw new GeminiError('bad_response', '응답 형식이 올바르지 않습니다.');
  const feedback = data.promptFeedback;
  if (isRecord(feedback) && typeof feedback.blockReason === 'string') {
    throw new GeminiError('blocked', `요청이 안전 정책으로 차단되었습니다(${feedback.blockReason}).`);
  }
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new GeminiError('bad_response', '생성된 답변이 없습니다.');
  }
  const first = candidates[0];
  if (!isRecord(first)) throw new GeminiError('bad_response', '답변 형식이 올바르지 않습니다.');
  const finish = typeof first.finishReason === 'string' ? first.finishReason : 'STOP';
  if (BLOCK_FINISH_REASONS.has(finish)) {
    throw new GeminiError('blocked', `답변이 안전 정책으로 중단되었습니다(${finish}).`);
  }
  if (finish === 'MAX_TOKENS') throw new GeminiError('bad_response', '답변이 길이 제한으로 잘렸습니다.');
  const content = first.content;
  const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter((p): p is Record<string, unknown> => isRecord(p) && typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text as string)
    .join('');
  if (!text.trim()) throw new GeminiError('bad_response', '답변 내용이 비어 있습니다.');
  return text;
}

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get('Retry-After'));
  return Number.isFinite(value) && value > 0 ? Math.min(120, Math.ceil(value)) : undefined;
}

/** 400 오류 본문에서 원인 종류만 뽑습니다(지역 제한·키 오류). 본문 자체는 버립니다. */
async function errorReason(response: Response): Promise<'location' | 'api_key' | ''> {
  try {
    const text = (await response.text()).slice(0, 4000);
    if (/location is not supported|FAILED_PRECONDITION/i.test(text)) return 'location';
    if (/API_KEY_INVALID|API key not valid/i.test(text)) return 'api_key';
    // 요청 형식 오류는 어느 필드가 문제인지(필드 경로만) 기록합니다. 학생 입력이나 결과는 담기지 않습니다.
    const fields = [...text.matchAll(/"field":\s*"([A-Za-z0-9_.[\]]{1,160})"/g)].map((m) => m[1]);
    if (fields.length) console.warn('gemini_invalid_field', [...new Set(fields)].slice(0, 5).join(','));
  } catch {
    /* 본문을 못 읽으면 일반 오류로 처리 */
  }
  return '';
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Gemini로 해석을 생성하고 서버에서 다시 검증한 결과를 돌려줍니다. */
export async function generateReading(
  request: ReadingRequest,
  config: GeminiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<Reading> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${API_BASE}/${encodeURIComponent(config.model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify(buildRequestBody(request, config)),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new GeminiError('timeout', 'AI 응답 시간이 초과되었습니다.');
    throw new GeminiError('upstream', 'AI 서버에 연결하지 못했습니다.');
  }

  let data: unknown;
  try {
    if (!response.ok) {
      const status = response.status;
      // 오류 본문은 종류를 구분하는 데만 쓰고, 요청 내용이 들어 있을 수 있으므로 기록하지 않습니다.
      const reason = status === 400 ? await errorReason(response) : (await response.body?.cancel(), '');
      if (status === 429) throw new GeminiError('quota', 'AI 사용량 한도에 도달했습니다.', status, retryAfter(response));
      if (status === 401 || status === 403) throw new GeminiError('auth', 'Gemini API 키 또는 권한을 확인해야 합니다.', status);
      if (status === 404) throw new GeminiError('model', 'Gemini 모델 이름을 확인해야 합니다.', status);
      if (reason === 'location') {
        throw new GeminiError('region', '현재 서버 위치에서는 Gemini API를 사용할 수 없습니다.', status);
      }
      if (reason === 'api_key') throw new GeminiError('auth', 'Gemini API 키가 올바르지 않습니다.', status);
      if (status === 400) throw new GeminiError('upstream', 'AI 요청 형식이 거부되었습니다.', status);
      throw new GeminiError('upstream', 'AI 서버가 일시적으로 응답하지 않습니다.', status);
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (controller.signal.aborted) throw new GeminiError('timeout', 'AI 응답 시간이 초과되었습니다.');
    throw new GeminiError('bad_response', 'AI 응답을 읽지 못했습니다.');
  } finally {
    clearTimeout(timer);
  }

  const text = extractText(data);
  try {
    return parseReading(text, request.cards.map((c) => c.id));
  } catch (error) {
    if (error instanceof ReadingFormatError) {
      throw new GeminiError('bad_response', `AI 응답 형식이 올바르지 않습니다: ${error.message}`);
    }
    throw error;
  }
}
