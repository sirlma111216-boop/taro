# GitHub 업로드와 Cloudflare 배포 안내

## 0. 준비

- GitHub 저장소: https://github.com/sirlma111216-boop/taro
- Cloudflare 계정(무료 플랜 가능), Worker 이름 `starlight-tarot` (`wrangler.jsonc` 의 `name` 과 같아야 함)
- Gemini API 키(Google AI Studio). 유료 결제가 연결된 프로젝트 권장.

학교망에서는 터미널을 열 때마다 먼저 실행합니다(학교 HTTPS 검사 인증서를 Node.js가 믿도록).

```powershell
$env:NODE_USE_SYSTEM_CA = "1"
```

## 1. 로컬 비밀값 만들기

```bash
npm ci
npm run setup:local
```

`.dev.vars` 를 메모장으로 열어 `GEMINI_API_KEY=` 뒤에 키를 넣습니다. (파일 탐색기에서는 `.dev` / 유형 "VARS 파일"로 보일 수 있습니다.)

## 2. Cloudflare 로그인과 비밀값 등록

```bash
npx wrangler login
npm run secrets:upload
npx wrangler secret list
```

- `secret list` 에 `GEMINI_API_KEY`, `OPERATOR_PASSWORD_HASH`, `OPERATOR_USERNAME`, `SESSION_SECRET` 네 개가 보이면 됩니다(값은 표시되지 않음).
- 대시보드에서 넣으려면: **Workers & Pages → starlight-tarot → Settings → Variables and Secrets → Add → Type: Secret**.
- `wrangler secret put` 으로 직접 넣을 때 입력 후 `*` 가 한 개만 보이면 값이 잘못 저장된 것입니다. `npm run secrets:upload` 를 쓰세요.

## 3. 배포

```bash
npm run verify
npm run deploy
```

배포가 끝나면 `https://starlight-tarot.<계정 하위 도메인>.workers.dev` 주소가 표시됩니다.

일일 입장 코드 저장소(Durable Object `DailyCodeStore`, 바인딩 `DAILY_CODE`)는 `wrangler.jsonc` 의 `migrations` 에 따라 첫 배포 때 자동으로 만들어집니다. SQLite 저장소 방식이라 무료 플랜에서도 쓸 수 있고, 따로 만들 것은 없습니다. `migrations` 의 `v1` 항목은 지우거나 바꾸지 마세요(저장소가 지워질 수 있음).

## 4. GitHub에 올리기

```bash
git add -A
git commit -m "변경 내용"
git push
```

처음 `git push` 때 GitHub 로그인 창이 뜨면 승인합니다. `.dev.vars`, `dist`, `node_modules` 는 `.gitignore` 로 제외됩니다. 커밋 전에 `npm run check:secrets` 로 비밀값이 섞이지 않았는지 확인하세요.

## 5. (선택) GitHub 연동 자동 배포

푸시할 때마다 Cloudflare가 직접 빌드·배포하게 할 수 있습니다. 학교망 인증서 문제도 피할 수 있습니다.

1. Cloudflare 대시보드 → **Workers & Pages → starlight-tarot → Settings → Builds → Connect**
2. GitHub 계정 연결 후 `sirlma111216-boop/taro` 선택, 운영 브랜치 `main`
3. 빌드 명령: `npm ci && npm run build` / 배포 명령: `npx wrangler deploy` / 루트 디렉터리: 비워 둠
4. 비밀값은 Worker 설정에 이미 있으므로 다시 넣을 필요 없습니다.

## 6. 배포 후 확인

1. 주소를 열면 운영자 로그인 화면이 나오는지
2. 로그인 후 타이틀에 "AI 해석 연결 설정이 필요합니다" 경고가 **없는지**
3. 체험을 한 번 끝까지 해서 해석이 나오는지(Gemini 1회 호출, 약 1센트)
4. 기념 카드 인쇄 미리보기가 엽서(100×148mm)·카드(54×86mm)에서 한 장에 들어가는지
5. 타이틀 오른쪽 아래의 희미한 열쇠 → 운영자 비밀번호 → **새 코드 만들기** → 다른 브라우저(또는 InPrivate 창)의 로그인 화면에서 **코드로 입장하기**로 들어가지는지

문제가 생기면 대시보드 **starlight-tarot → Observability → Logs** 에서 `gemini_error` 종류(예: `upstream 400`, `region`, `auth`)와 `gemini_invalid_field`(문제 필드 이름)를 확인합니다. 학생 결과나 요청 본문은 로그에 남지 않습니다.

## 자주 생기는 오류

| 증상 | 원인 | 해결 |
|---|---|---|
| `wrangler login` 이 "fetch failed", 로그에 `SELF_SIGNED_CERT_IN_CHAIN` | 학교망 HTTPS 검사 | `$env:NODE_USE_SYSTEM_CA = "1"` 후 다시 |
| 로그인 시 "운영자 로그인 설정이 필요합니다" | 비밀값 누락·잘림 | `npm run secrets:upload` |
| 해석 시 "AI 해석 연결 설정이 필요합니다" | `GEMINI_API_KEY` 없음/잘못됨, 모델 이름 오류 | 키 다시 등록, `GEMINI_MODEL` 확인 |
| "현재 서버 위치에서는 Gemini API를 쓸 수 없습니다" | Gemini 미지원 지역에서 호출 | `wrangler.jsonc` 의 `placement.region` 확인 |
| 로그의 `gemini_invalid_field` | 요청 형식 오류 | 필드 이름을 보고 `src/worker/gemini.ts` 수정 |
| "일일 코드 저장소(DAILY_CODE) 설정이 필요합니다" | Durable Object 바인딩 없음 | `wrangler.jsonc` 의 `durable_objects`·`migrations` 확인 후 다시 배포 |
| 코드 입장이 "맞지 않거나 사용 기간이 끝났어요" | 코드 오타, 24시간 지남, 새 코드로 바뀜 | 열쇠 아이콘에서 지금 코드 확인 |
