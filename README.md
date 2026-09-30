# 별빛서가 — 너의 내일을 펼치다

중학교 축제 부스용 한국어 타로 웹앱입니다. 학생 한 명이 2~4분 동안 세 장의 카드를 고르고, Gemini가 만든 해석을 본 뒤 작은 기념 카드를 인쇄합니다.
타로는 미래를 정하는 예언이 아니라, 나를 돌아보고 작은 행동을 떠올리게 돕는 체험으로 다룹니다.

- 대상 기기: PC·노트북·태블릿 (휴대전화는 대상 아님)
- 구조: Vite + TypeScript 화면 → 같은 주소의 Cloudflare Worker API → Gemini API
- 데이터베이스 없음. 학생 이름·학번·연락처를 받지 않습니다.

## 체험 흐름

운영자 로그인(부스 열기) → 타이틀 → 성별 선택(추천 순서에만 사용) → 운세 주제 12가지 → 78장 전체 덱을 섞어 15장을 펼침 → 세 장 선택(지금의 나 / 다가오는 흐름 / 나에게 필요한 행동) → 고른 카드를 크게 뒤집어 보여 주며 AI 해석 → 카드별 해석 3화면 → 종합 해석 → 기념 카드 인쇄(Canon SELPHY CP1300: 엽서 100×148mm 또는 카드 54×86mm) → 종료

- Escape를 1초 안에 두 번 누르거나 **처음으로** 버튼을 두 번 누르면 언제든 타이틀로 돌아갑니다(운영자 로그인은 유지).
- 모든 화면 전환에 부드러운 애니메이션이 있고, 운영체제의 "움직임 줄이기" 설정을 따릅니다.

## 폴더 구조

```
src/
  shared/   카드 78장·주제·배열·셔플·해석 입출력 검증 (화면과 서버가 함께 사용)
  worker/   Cloudflare Worker: 로그인·세션·요청 제한·Gemini 호출·모의 응답
  client/   화면(장면·카드·인쇄·소리·Escape 처리)
public/
  assets/cards/    카드 앞면 78장(<카드ID>.webp) + card-back.webp
  assets/scenes/   장면 배경 (title, choice, table, reading, result)
  assets/select/   성별·주제 선택 그림 15장
  assets/print/    인쇄 배경 (엽서 100×148mm, 카드 54×86mm)
  audio/           음원 교체용 manifest.json (비어 있으면 기본 합성음·음성합성 사용)
scripts/    카드 가져오기, 비밀값 설정·업로드, 자산·비밀값 점검
tests/      단위 테스트(vitest), 실제 브라우저 E2E 테스트(playwright-core + Edge/Chrome)
docs/       조사·프롬프트·대본·운영 문서
```

## 로컬에서 실행하기

필요: Node.js 22.18 이상(24 권장), Git.

```bash
npm ci
npm run setup:local
npm run dev
```

1. `npm run setup:local` 이 운영자 아이디·비밀번호를 묻고 `.dev.vars` 를 만듭니다. 비밀번호는 PBKDF2 해시로만 저장됩니다.
2. `.dev.vars` 의 `GEMINI_API_KEY=` 뒤에 Google AI Studio에서 만든 키를 넣습니다.
3. 키 없이 화면만 보려면 `.dev.vars` 에 `AI_MODE=mock` 을 추가합니다. 모의 응답은 localhost에서만 동작하고 화면에 "테스트용 모의 응답"으로 표시됩니다.
4. http://localhost:5173 을 엽니다.

> **학교망처럼 HTTPS를 검사하는 네트워크**에서는 Node.js가 학교 인증서를 믿지 않아 `wrangler login` 등이 `SELF_SIGNED_CERT_IN_CHAIN` 으로 실패할 수 있습니다. 터미널에서 먼저 `$env:NODE_USE_SYSTEM_CA = "1"` (PowerShell) 을 실행하세요.

## 비밀값과 설정값

비밀값은 저장소에 절대 넣지 않습니다. 로컬은 `.dev.vars`(Git 제외), 운영은 Cloudflare Secrets에 둡니다.

| 이름 | 종류 | 설명 |
|---|---|---|
| `OPERATOR_USERNAME` | 비밀 | 운영자 아이디 (하나뿐, 회원가입 없음) |
| `OPERATOR_PASSWORD_HASH` | 비밀 | 운영자 비밀번호의 PBKDF2 해시 (`npm run hash-password`) |
| `SESSION_SECRET` | 비밀 | 세션 쿠키 서명용 32자 이상 무작위 문자열 |
| `GEMINI_API_KEY` | 비밀 | Gemini API 키 (`AQ.` 로 시작하는 새 인증 키도 사용 가능) |
| `GEMINI_MODEL` | 설정 | 기본 `gemini-3.8-flash` |
| `GEMINI_THINKING_LEVEL` | 설정 | 기본 `low` (빠른 응답) |
| `GEMINI_TIMEOUT_MS` | 설정 | 기본 35000 |
| `SESSION_TTL_HOURS` | 설정 | 운영자 로그인 유지 시간, 기본 10 |
| `AI_MODE` | 설정 | `gemini`(기본) 또는 `mock`(localhost 전용) |

설정값은 `wrangler.jsonc` 의 `vars` 에서 바꿉니다.

## 배포 (Cloudflare Workers)

```bash
npx wrangler login
npm run secrets:upload
npm run deploy
```

- `npm run secrets:upload` 는 `.dev.vars` 의 아이디·비밀번호 해시·Gemini 키를 읽고, 운영용 `SESSION_SECRET` 을 새로 만들어 한 번에 올립니다. 터미널에 붙여 넣지 않으므로 값이 잘리지 않습니다.
- `wrangler secret put` 으로 직접 입력할 때 입력 후 `*` 가 한 개만 보이면 값이 한 글자로 저장된 것입니다(일부 터미널에서 Ctrl+V가 붙여넣기 대신 제어 문자를 보냄). 이 경우 `npm run secrets:upload` 를 쓰세요.
- GitHub 연동 자동 배포, 사용자 지정 도메인 등은 [docs/deploy-guide.md](docs/deploy-guide.md)를 보세요.

## 테스트

```bash
npm test
npm run test:e2e
npm run verify
```

- `npm test`: 단위 테스트(카드 데이터, 셔플, 요청·응답 검증, 로그인·세션, 요청 제한, Gemini 오류 처리). Gemini는 호출하지 않습니다.
- `npm run test:e2e`: 설치된 Edge/Chrome으로 전체 흐름·Escape·오류/재시도·인쇄 PDF·화면 크기별 배치를 확인합니다. 테스트 전용 임시 계정과 **모의 응답만** 사용합니다.
- `npm run verify`: 타입 검사 + 단위 테스트 + 빌드 + 비밀값 유출 점검.
- `npm run check:secrets`: Git에 올라갈 파일과 배포되는 빌드에 실제 비밀값·키 형식 문자열이 없는지 확인합니다.
- `npm run check:assets`: 카드 78장·배경·선택 그림·인쇄 배경·음원 목록을 확인합니다.

## 그림·소리 교체

- 카드: `npm run cards:import -- "<카드 폴더>"` — `major-00`~`major-21`, `<슈트>-ace|02..10|page|knight|queen|king` 이름을 카드 ID로 바꿔 넣고 확인용 목록 이미지(`docs/art-reference/contact-sheet.webp`)를 만듭니다.
- 장면·선택·인쇄 배경: 같은 파일 이름으로 덮어쓰면 됩니다.
- 음악·효과음·음성: `public/audio/` 에 파일을 넣고 `public/audio/manifest.json` 에 경로를 적습니다. 비어 있으면 Web Audio 합성음과 브라우저 한국어 음성합성(없으면 자막만)을 씁니다.

## 보안·개인정보

- 인증은 서버에서만 처리합니다. HttpOnly·Secure·SameSite=Strict 쿠키, 로그인 시도 제한(1분 5회 + 실패 누적 잠금), 같은 출처 확인.
- 로그인하지 않은 AI 요청은 서버가 거부합니다(401).
- 서버는 카드 이름·의미를 클라이언트가 보낸 값이 아니라 서버의 카드 데이터에서 조회합니다. 성별은 AI에 보내지 않습니다.
- Gemini 요청은 `store: false` 로 보내 요청 로그 저장을 끕니다. 이는 이 요청의 로그 저장 설정일 뿐, Google의 약관에 따른 처리 전체를 없앤다는 뜻은 아닙니다.
- AI 결과는 화면에 `textContent` 로만 넣습니다(HTML 삽입 없음). 요청 본문·AI 결과·API 키는 로그에 남기지 않습니다.

## 알려진 한계

- 긴급 복귀 시 브라우저 쪽 요청은 즉시 취소되지만, 이미 서버에서 시작된 Gemini 처리는 취소가 보장되지 않습니다. 늦게 도착한 결과는 화면에서 버립니다.
- 브라우저 인쇄 창이 열려 있는 동안에는 웹앱이 Escape 키를 받을 수 없습니다.
- `window.print()` 는 실제 출력 성공 여부를 알려 주지 않으므로 앱은 "인쇄 창이 닫혔어요"까지만 안내합니다.
- 요청 제한은 Cloudflare 위치별로 계산되며, Worker 메모리 기반 보조 제한은 인스턴스마다 따로 셉니다.

## 저작권

카드 78장·장면·선택 그림은 이 프로젝트를 위해 새로 제작한 그림입니다. 카드 번호·이름·전통 상징은 1909년 라이더–웨이트–스미스 덱과 A. E. Waite의 『The Pictorial Key to the Tarot』(퍼블릭 도메인)의 전통을 참고했고, 해석 문장은 새로 썼습니다. 자세한 내용은 [docs/tarot-research.md](docs/tarot-research.md)를 보세요.
