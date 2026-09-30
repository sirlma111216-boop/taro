/*
 * 이미지·소리 자산 점검
 *   npm run check:assets
 * 카드 78장·카드 뒷면·장면 배경·선택 그림·인쇄 배경이 모두 있는지, 파일 이름이 카드 ID와 맞는지,
 * public/audio/manifest.json 에 적은 음원 파일이 실제로 있는지 확인합니다.
 * 빠진 카드는 앱이 기본 제작 SVG 카드로 표시하므로 오류가 아니라 경고로 알립니다.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CARDS } from '../src/shared/cards.ts';
import { TOPICS } from '../src/shared/topics.ts';
import { scanCardArt } from './card-art.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PUB = join(ROOT, 'public');
const errors: string[] = [];
const warnings: string[] = [];

const art = scanCardArt(ROOT);
const missingCards = CARDS.filter((c) => !art.art[c.id]).map((c) => c.id);
if (missingCards.length) warnings.push(`카드 그림 없음 ${missingCards.length}장(기본 SVG로 표시): ${missingCards.join(', ')}`);
if (!art.back) warnings.push('카드 뒷면(card-back) 그림 없음 — 기본 SVG로 표시');
for (const f of art.unknown) errors.push(`카드 폴더에 알 수 없는 파일: ${f}`);
for (const f of art.duplicates) errors.push(`같은 카드 그림이 여러 개: ${f}`);

const required = [
  ...['title', 'reading', 'choice', 'table', 'result'].map((s) => `assets/scenes/${s}.webp`),
  ...['girl', 'boy', 'none'].map((g) => `assets/select/gender-${g}.webp`),
  ...TOPICS.map((t) => `assets/select/topic-${t.id}.webp`),
  'assets/print/print-postcard.png',
  'assets/print/print-card.png',
];
for (const file of required) {
  if (!existsSync(join(PUB, file))) errors.push(`필수 그림 없음: public/${file}`);
}

const manifestFile = join(PUB, 'audio', 'manifest.json');
let audioFiles = 0;
try {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  for (const group of ['music', 'sfx', 'voice']) {
    const entries = (manifest[group] ?? {}) as Record<string, string | null>;
    for (const [key, path] of Object.entries(entries)) {
      if (!path) continue;
      audioFiles++;
      if (!existsSync(join(PUB, path))) errors.push(`음원 파일 없음: ${group}.${key} → public/${path}`);
    }
  }
} catch (error) {
  errors.push(`public/audio/manifest.json 을 읽지 못함: ${(error as Error).message}`);
}

let totalBytes = 0;
for (const card of CARDS) {
  const path = art.art[card.id];
  if (path) totalBytes += statSync(join(PUB, path)).size;
}

console.log(`카드 그림 ${78 - missingCards.length}/78장 (${(totalBytes / 1024 / 1024).toFixed(1)}MB), 필수 그림 ${required.length}개 확인, 등록된 음원 ${audioFiles}개`);
for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log('✓ 자산 점검 통과');
