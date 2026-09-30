import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { cardArtPlugin } from './scripts/vite-card-art.ts';

// E2E 테스트는 테스트 전용 설정(임시 계정·모의 AI)으로 서버를 띄우기 위해 설정 파일 경로를 바꿀 수 있습니다.
const configPath = process.env.STARLIGHT_WRANGLER_CONFIG;

export default defineConfig({
  plugins: [cloudflare(configPath ? { configPath, inspectorPort: false, persistState: false } : {}), cardArtPlugin()],
  cacheDir: configPath ? 'node_modules/.vite-e2e' : 'node_modules/.vite',
  build: {
    target: 'es2022',
    // 카드·배경 이미지는 public 폴더에서 그대로 제공하고, 번들에는 코드와 폰트만 넣습니다.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: true,
  },
});
