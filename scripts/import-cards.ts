/*
 * 카드 이미지 가져오기
 *   npm run cards:import -- "<카드 폴더 경로>"
 *
 * - 파일 이름을 카드 ID로 바꿔 public/assets/cards/<id>.webp 로 저장합니다.
 *   major-00 ~ major-21, <슈트>-01 ~ -14 (ace=01, page=11, knight=12, queen=13, king=14)
 *   예) cups-ace.webp → cups-01.webp, swords-queen.png → swords-13.webp
 * - 78장이 모두 있는지, 중복·알 수 없는 파일이 없는지, 세로 2:3 비율인지 확인합니다.
 * - 1024×1536 WebP로 맞추고, 확인용 목록 이미지(docs/art-reference/contact-sheet.webp)를 만듭니다.
 * - card-back 파일이 있으면 카드 뒷면으로 함께 가져옵니다.
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { CARDS } from '../src/shared/cards.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'assets', 'cards');
const SHEET = join(ROOT, 'docs', 'art-reference', 'contact-sheet.webp');
const WIDTH = 1024;
const HEIGHT = 1536;
const EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif']);
const RANK_ALIAS: Record<string, string> = { ace: '01', page: '11', knight: '12', queen: '13', king: '14' };

export function normalizeCardName(fileName: string): string | null {
  const base = basename(fileName, extname(fileName)).toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (base === 'card-back' || base === 'back') return 'card-back';
  const major = /^major-(\d{1,2})$/.exec(base);
  if (major) {
    const n = Number(major[1]);
    return n >= 0 && n <= 21 ? `major-${String(n).padStart(2, '0')}` : null;
  }
  const minor = /^(wands|cups|swords|pentacles)-(\w+)$/.exec(base);
  if (minor) {
    const rank = minor[2]!;
    const alias = RANK_ALIAS[rank];
    if (alias) return `${minor[1]}-${alias}`;
    const n = Number(rank);
    return Number.isInteger(n) && n >= 1 && n <= 14 ? `${minor[1]}-${String(n).padStart(2, '0')}` : null;
  }
  return null;
}

async function main(): Promise<void> {
  const source = process.argv[2];
  if (!source || !existsSync(source) || !statSync(source).isDirectory()) {
    console.error('사용법: npm run cards:import -- "<카드 이미지 폴더>"');
    process.exit(1);
  }

  const found = new Map<string, string>();
  const unknown: string[] = [];
  const duplicate: string[] = [];
  for (const file of readdirSync(source).sort()) {
    if (!EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const id = normalizeCardName(file);
    if (!id) {
      unknown.push(file);
      continue;
    }
    if (found.has(id)) {
      duplicate.push(`${file} (이미 ${basename(found.get(id)!)})`);
      continue;
    }
    found.set(id, join(source, file));
  }

  const missing = CARDS.map((c) => c.id).filter((id) => !found.has(id));
  if (unknown.length) console.warn(`⚠ 카드 이름으로 읽을 수 없는 파일 ${unknown.length}개: ${unknown.join(', ')}`);
  if (duplicate.length) console.warn(`⚠ 같은 카드가 여러 번 있습니다: ${duplicate.join(', ')}`);
  if (missing.length) console.warn(`⚠ 없는 카드 ${missing.length}장: ${missing.join(', ')} (앱은 이 카드들을 기본 제작 카드로 표시합니다)`);

  mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  let totalBytes = 0;
  for (const [id, file] of found) {
    const meta = await sharp(file).metadata();
    const ratio = (meta.width ?? 1) / (meta.height ?? 1);
    if (Math.abs(ratio - WIDTH / HEIGHT) > 0.02) {
      console.warn(`⚠ ${basename(file)}: ${meta.width}×${meta.height} — 세로 2:3 비율이 아니라서 가운데를 기준으로 잘라 맞춥니다.`);
    }
    const target = join(OUT_DIR, `${id}.webp`);
    const sameSize = meta.width === WIDTH && meta.height === HEIGHT && meta.format === 'webp';
    const encoded = await sharp(file)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer();
    const originalSize = statSync(file).size;
    if (sameSize && encoded.length > originalSize * 0.8) {
      // 이미 규격에 맞는 WebP이고 다시 압축해도 크게 줄지 않으면 원본을 그대로 씁니다(화질 보존).
      copyFileSync(file, target);
      totalBytes += originalSize;
    } else {
      await sharp(encoded).toFile(target);
      totalBytes += encoded.length;
    }
    written++;
  }
  console.log(`✓ ${written}장을 ${OUT_DIR} 에 저장했습니다. (합계 ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);

  await buildContactSheet();
  console.log(`✓ 확인용 목록 이미지: ${SHEET}`);
  if (missing.length || unknown.length || duplicate.length) process.exitCode = 2;
}

/** 78장을 카드 ID와 함께 한 장에 모아 매핑을 눈으로 확인합니다. */
export async function buildContactSheet(): Promise<void> {
  const cols = 13;
  const tw = 150;
  const th = 225;
  const label = 26;
  const gap = 6;
  const rows = Math.ceil(CARDS.length / cols);
  const width = cols * (tw + gap) + gap;
  const height = rows * (th + label + gap) + gap;
  const composites: sharp.OverlayOptions[] = [];
  for (const [i, card] of CARDS.entries()) {
    const x = gap + (i % cols) * (tw + gap);
    const y = gap + Math.floor(i / cols) * (th + label + gap);
    const file = join(OUT_DIR, `${card.id}.webp`);
    if (existsSync(file)) {
      composites.push({ input: await sharp(file).resize(tw, th).toBuffer(), left: x, top: y });
    }
    const text = `${card.id} ${card.nameEn.replace('The ', '')}`.replace(/&/g, '&amp;');
    const svgLabel = Buffer.from(
      `<svg width="${tw}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#15123a"/><text x="4" y="17" font-family="Arial, sans-serif" font-size="11.5" fill="${existsSync(file) ? '#f6efe0' : '#ff8a8a'}">${text}</text></svg>`,
    );
    composites.push({ input: svgLabel, left: x, top: y + th });
  }
  mkdirSync(join(ROOT, 'docs', 'art-reference'), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#0b0a22' } })
    .composite(composites)
    .webp({ quality: 80 })
    .toFile(SHEET);
}

if (import.meta.main ?? process.argv[1]?.endsWith('import-cards.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
