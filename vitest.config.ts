import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cardArtPlugin } from './scripts/vite-card-art.ts';

// 단위 테스트는 Node 환경에서 실행합니다. (Worker 코드는 표준 Request/Response/Web Crypto만 사용)
export default defineConfig({
  plugins: [cardArtPlugin()],
  // Durable Object 기반 클래스('cloudflare:workers')는 Node에 없으므로 테스트용 대역으로 바꿉니다.
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/unit/stubs/cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
