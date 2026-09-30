/*
 * 녹음한 안내 음성 파일 연결
 *   npm run voice:sync
 *
 * public/audio/voice/ 폴더에서 대본 ID와 같은 이름의 파일(예: title.mp3, pick_1.wav)을 찾아
 * public/audio/manifest.json 의 voice 항목에 경로를 적어 줍니다. 파일이 없는 줄은 null(브라우저 음성)로 둡니다.
 * 대본과 파일 이름 목록: docs/voice-script.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { VOICE_LINES } from '../src/client/audio/voice-lines.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'public', 'audio', 'voice');
const MANIFEST = join(ROOT, 'public', 'audio', 'manifest.json');
const EXT = ['.mp3', '.m4a', '.ogg', '.wav', '.webm'];

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => EXT.includes(extname(f).toLowerCase())) : [];
const byId = new Map<string, string>();
const unknown: string[] = [];
for (const file of files) {
  const id = file.slice(0, -extname(file).length);
  if (id in VOICE_LINES) byId.set(id, `audio/voice/${file}`);
  else unknown.push(file);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, unknown>;
const voice: Record<string, string | null> = {};
let linked = 0;
for (const [id, line] of Object.entries(VOICE_LINES)) {
  if ('captionOnly' in line && line.captionOnly) continue;
  voice[id] = byId.get(id) ?? null;
  if (voice[id]) linked++;
}
manifest.voice = voice;
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const total = Object.keys(voice).length;
console.log(`✓ 안내 음성 ${linked}/${total}개 연결 (public/audio/manifest.json 갱신)`);
const missing = Object.keys(voice).filter((id) => !voice[id]);
if (missing.length) console.log(`  아직 파일이 없는 줄(브라우저 음성으로 읽음): ${missing.join(', ')}`);
if (unknown.length) console.warn(`⚠ 대본 ID와 이름이 맞지 않는 파일: ${unknown.join(', ')} (docs/voice-script.md 의 ID로 이름을 바꿔 주세요)`);
