/*
 * docs/voice-script.md 만들기 (대본의 원본은 src/client/audio/voice-lines.ts)
 *   npm run docs:voice
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VOICE_LINES } from '../src/client/audio/voice-lines.ts';

const ROOT = resolve(import.meta.dirname, '..');
const rows = Object.values(VOICE_LINES)
  .filter((line) => !('captionOnly' in line && line.captionOnly))
  .map((line) => `| \`${line.id}\` | ${line.scene} | ${line.text} |`);
const captionOnly = Object.values(VOICE_LINES)
  .filter((line) => 'captionOnly' in line && line.captionOnly)
  .map((line) => `- \`${line.id}\` (${line.scene}): ${line.text}`);

const md = `# 안내 음성 대본과 녹음 파일 안내

> 이 문서는 \`npm run docs:voice\` 로 \`src/client/audio/voice-lines.ts\` 에서 자동으로 만듭니다. 대본을 고치려면 그 파일을 고친 뒤 다시 실행하세요.

## 1. 녹음 방법 요약

1. 아래 표의 **대본**을 녹음하고, 파일 이름을 **ID** 와 똑같이 저장합니다. 예: \`title.mp3\`, \`pick_1.mp3\`
2. 파일을 \`public/audio/voice/\` 폴더에 넣습니다.
3. 터미널에서 \`npm run voice:sync\` 를 실행하면 앱이 파일을 찾아 연결합니다.
4. 배포: \`npm run deploy\` (또는 GitHub에 올리면 자동 배포 설정 시 반영)

녹음 파일이 있는 줄은 그 파일을, 없는 줄은 브라우저 음성(타이틀 화면 아래 "안내 음성"에서 선택)으로 읽습니다.

## 2. 파일 규격 (권장)

- 형식: MP3(128~192kbps) 또는 WAV. 모노도 괜찮습니다.
- 앞뒤 무음: 0.2초 이하 (길면 화면과 음성이 어긋나 보입니다)
- 음량: 파일끼리 비슷하게. 가능하면 -16 LUFS 전후, 최대 -1 dB를 넘지 않게
- 배경음악·효과음 없이 목소리만

## 3. 목소리 스타일 (녹음·음성 생성 서비스용 설명)

차분하고 친근한 20대 후반 여성 안내자. 신비로운 천문 도서관의 타로 안내자이지만 무섭거나 음산하지 않고, 중학생을 따뜻하게 맞이하는 목소리.
해요체 존댓말로, 평소 말하기보다 조금 느리고 또렷하게. 문장 끝을 부드럽게 내리고, 쉼표·마침표에서 짧게 쉽니다.
과장된 성우 연기, 속삭임, 극적인 떨림, 공포 분위기, 광고 같은 높은 톤은 피합니다. 미소를 머금은 듯 편안한 톤.

(영문 서비스용) *A calm, friendly Korean woman in her late twenties, a gentle tarot guide in a moonlit library. Warm and reassuring for middle-school students, never spooky. Polite Korean (haeyo-che), slightly slower than conversation, clear articulation, soft sentence endings, short natural pauses. No exaggerated acting, no whispering, no dramatic tremolo.*

## 4. 고정 대본 (녹음할 줄)

| ID (파일 이름) | 장면 | 대본 |
|---|---|---|
${rows.join('\n')}

## 5. 매번 달라지는 부분 (AI 해석 결과)

AI가 학생마다 새로 만드는 문장은 미리 녹음할 수 없습니다. 앱은 다음 순서로 읽습니다.

- **카드별 결과**: [녹음 \`card_1\`~\`card_3\`] → 카드 이름·방향 → 한 문장 결론(headline) → "작은 행동으로는," + 행동 제안(action)
- **종합 결과**: [녹음 \`summary\`] → 제목(title) → 핵심 결론(conclusion) → "오늘의 작은 행동은," + 오늘의 행동(todayAction)
- 상징 해설·주제 해석·통합 설명·조심할 점·준비할 점은 화면에만 보여 주고 읽지 않습니다(체험 시간 2~4분 유지).

녹음한 목소리와 브라우저 음성이 섞이는 것이 어색하면 \`public/audio/manifest.json\` 에서 \`"readAiResults": false\` 로 바꾸세요. 그러면 고정 안내만 녹음 목소리로 나오고, AI 해석은 화면과 자막으로만 보여 줍니다.

## 6. 자막으로만 보여 주는 줄 (녹음 불필요)

${captionOnly.join('\n')}
`;

writeFileSync(join(ROOT, 'docs', 'voice-script.md'), md, 'utf8');
console.log('✓ docs/voice-script.md 를 만들었습니다.');
