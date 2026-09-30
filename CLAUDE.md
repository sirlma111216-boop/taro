# CLAUDE.md — 별빛서가 프로젝트 안내

중학교 축제용 한국어 타로 웹앱. Vite + TypeScript(프레임워크 없음) 화면과 Cloudflare Worker API, Gemini 해석.
사용자 안내 문서는 한국어로 씁니다. 코드 주석도 한국어가 기본입니다.

## 명령

- `npm run dev` — Vite + Cloudflare 플러그인 개발 서버(http://localhost:5173). `.dev.vars` 를 읽음.
- `npm test` — vitest 단위 테스트(`tests/unit`). Gemini는 fetch 모의로만 테스트.
- `npm run test:e2e` — `tests/e2e/run-e2e.ts`. 임시 설정(`tests/e2e/.tmp`)으로 5199 포트 서버를 띄우고 Edge/Chrome을 playwright-core로 제어. `AI_MODE=mock` 만 사용. `E2E_ONLY="이름 일부"` 로 일부만 실행.
- `npm run typecheck` — worker / node / client 세 tsconfig를 각각 검사.
- `npm run verify` — typecheck + test + build + check:secrets.
- `npm run cards:import -- "<폴더>"` — 카드 그림을 `public/assets/cards/<id>.webp` 로 가져오고 목록 이미지 생성.
- `npm run secrets:upload` — `.dev.vars` → Cloudflare Secrets (값 출력 없음, SESSION_SECRET 새로 생성).

## 구조

- `src/shared/` 카드 데이터(`cards.ts`, ID: `major-00..21`, `<suit>-01..14`, 01=에이스 11=페이지 12=나이트 13=퀸 14=킹), 주제(`topics.ts`), 배열(`spread.ts`), 셔플(`random.ts`, Web Crypto + 거부 샘플링), 입출력 검증과 JSON 스키마(`reading.ts`).
- `src/worker/` `index.ts`(라우팅·요청 제한·중복 요청 방지), `auth.ts`(PBKDF2 100,000회·HMAC 서명 세션 쿠키), `gemini.ts`(REST 호출), `prompt.ts`(시스템 지침), `mock.ts`(localhost 전용 모의 응답).
- `src/client/` `app.ts`가 화면 전환·긴급 복귀·AI 요청 세대(generation) 관리. 모든 비동기 결과는 `app.isCurrent(gen)` 로 늦은 응답을 버림. 애니메이션·타이머는 `MotionRegistry` 에 등록해야 복귀 때 함께 취소됨.
- 카드 그림 목록은 Vite 가상 모듈 `virtual:card-art` 가 빌드 때 `public/assets/cards` 를 훑어 만듦. 그림이 없으면 SVG 기본 카드.

## Gemini 연동 규칙 (2026-09 공식 문서·실제 호출로 확인)

- 모델: `gemini-3.8-flash` (환경변수 `GEMINI_MODEL`). `gemini-2.x`, `1.5` 계열 금지.
- 엔드포인트: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, 헤더 `x-goog-api-key`.
- 구조화 출력: `generationConfig.responseFormat.text = { mimeType: "APPLICATION_JSON", schema }`.
  **`mimeType` 은 enum 이름 `APPLICATION_JSON` 이어야 함.** 문서 예제의 `"application/json"` 은 400 INVALID_ARGUMENT.
- `thinkingConfig.thinkingLevel: "low"`. 3.8 Flash는 `minimal` 미지원. `temperature`/`topP`/`topK` 는 넣지 않음.
- `maxOutputTokens` 는 생각 토큰 포함 상한 → 8192로 넉넉히. `finishReason: MAX_TOKENS` 는 오류로 처리.
- 요청 단위 `store: false`.
- 키: `AQ.` 로 시작하는 새 "인증 키"도 `x-goog-api-key` 헤더로 정상 동작(모델 목록·countTokens로 확인).
- 요청 형식 확인은 **무료인 `:countTokens`** 에 `{ generateContentRequest: { model: "models/…", ...body } }` 로 보내서 한다.
- 한국은 지원 지역, 홍콩은 아님. `wrangler.jsonc` 의 `placement.region = gcp:asia-northeast3` 로 Worker 위치 고정.
- 서버가 카드 이름·상징·의미를 서버 데이터에서 넣고, 결과는 `parseReading` 으로 카드 ID·순서·길이·확률 표현을 다시 검증.

## 반드시 지킬 것

- **유료 API 절약:** 자동 테스트는 항상 모의 응답. 실제 Gemini 생성 호출은 사용자에게 목적·비용을 알리고 허락받은 뒤 최소 횟수만.
- 비밀값(키·해시·세션 비밀값·운영자 아이디)을 코드·문서·예시 파일·로그·Git에 넣지 않음. 커밋 전 `npm run check:secrets`.
- AI 결과는 `textContent` 로만 표시. 학생 결과·요청 본문을 `console.log` 하지 않음(오류 종류만 기록).
- 해석 지침: 미래 확정·확률 꾸미기·타인 속마음 단정·공포/죽음/사고 예언·도박/과소비 권유 금지. 죽음·악마·탑 카드는 숨기지 말고 변화·습관·재정비의 상징으로.
- 성별은 묻지 않음(2026-09-30 사용자 결정: 성별 선택 단계 삭제, AI에도 반영하지 않음). 주제 12개는 4×3으로 한 화면에.
- 기념 카드 이름(닉네임)은 화면·인쇄에만 쓰고 서버·AI로 보내거나 저장하지 않음. 체험 종료 시 xperience.printName 을 비움.
- 학생에게는 해요체로 통일. 이름에 반말 호격("민지야")을 붙여 존댓말 문장과 섞지 않음. 조사는 src/shared/josa.ts 로 받침에 맞춰 고르고, 판단이 어려운 영문·기호 이름은 조사가 바뀌지 않는 표현("~의")을 씀.
- 대상 기기: PC·노트북·태블릿. 휴대전화 최적화는 하지 않음.

## 환경 주의

- 학교망은 HTTPS 검사(수산INT ePrism SSL)를 함. Node/wrangler는 `NODE_USE_SYSTEM_CA=1` 이 있어야 Cloudflare·Google에 연결됨.
- 이 앱의 터미널 패널에서 `wrangler secret put` 에 Ctrl+V로 붙여 넣으면 값이 1글자로 저장될 수 있음 → `npm run secrets:upload` 사용.
- 프로젝트가 OneDrive 폴더 안에 있어 `.dev.vars` 도 OneDrive에 동기화됨(Git에는 안 올라감).
