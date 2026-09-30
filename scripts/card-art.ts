import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * public/assets/cards 폴더를 훑어 "카드 ID → 이미지 경로" 목록을 만듭니다.
 * - 파일 이름이 카드 ID와 같아야 연결됩니다. 예: major-17.webp, cups-11.png
 * - 이미지가 없는 카드는 앱이 직접 그린 기본 SVG 카드로 표시됩니다(깨진 이미지 없음).
 * - 알 수 없는 파일 이름은 경고로 알려 매핑 실수를 막습니다.
 */

export const CARD_DIR = join('public', 'assets', 'cards');
export const CARD_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.avif'];
const SPECIAL_FILES = new Set(['card-back']);
const ID_PATTERN = /^(major-(0\d|1\d|2[01])|(wands|cups|swords|pentacles)-(0[1-9]|1[0-4]))$/;

export interface CardArtScan {
  art: Record<string, string>;
  back: string | null;
  unknown: string[];
  duplicates: string[];
}

export function scanCardArt(root: string): CardArtScan {
  const dir = join(root, CARD_DIR);
  const result: CardArtScan = { art: {}, back: null, unknown: [], duplicates: [] };
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).sort()) {
    const full = join(dir, file);
    if (!statSync(full).isFile()) continue;
    const dot = file.lastIndexOf('.');
    if (dot < 0) continue;
    const base = file.slice(0, dot).toLowerCase();
    const ext = file.slice(dot).toLowerCase();
    if (!CARD_EXTENSIONS.includes(ext)) {
      if (!file.startsWith('.') && file !== 'README.txt') result.unknown.push(file);
      continue;
    }
    const url = `assets/cards/${file}`;
    if (SPECIAL_FILES.has(base)) {
      result.back = url;
      continue;
    }
    if (!ID_PATTERN.test(base)) {
      result.unknown.push(file);
      continue;
    }
    if (result.art[base]) {
      result.duplicates.push(file);
      continue;
    }
    result.art[base] = url;
  }
  return result;
}

export function isValidCardId(id: string): boolean {
  return ID_PATTERN.test(id);
}
