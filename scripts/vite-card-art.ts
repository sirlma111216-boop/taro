import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { CARD_DIR, scanCardArt } from './card-art.ts';

const VIRTUAL_ID = 'virtual:card-art';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** `import cardArt from 'virtual:card-art'` 로 현재 있는 카드 이미지 목록을 제공합니다. */
export function cardArtPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'starlight-card-art',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const scan = scanCardArt(root);
      for (const file of scan.unknown) {
        this.warn(`[카드 이미지] 알 수 없는 파일 이름: ${file} (예: major-00.webp, cups-11.webp)`);
      }
      for (const file of scan.duplicates) {
        this.warn(`[카드 이미지] 같은 카드의 이미지가 여러 개입니다: ${file}`);
      }
      return `export default ${JSON.stringify({ art: scan.art, back: scan.back })};`;
    },
    configureServer(server) {
      const dir = resolve(root, CARD_DIR);
      server.watcher.add(dir);
      const refresh = (file: string) => {
        if (!resolve(file).startsWith(dir)) return;
        for (const env of Object.values(server.environments)) {
          const mod = env.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) env.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}

export const CARD_DIR_ABSOLUTE = (root: string) => join(root, CARD_DIR);
