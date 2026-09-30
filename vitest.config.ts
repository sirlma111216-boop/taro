import { defineConfig } from 'vitest/config';
import { cardArtPlugin } from './scripts/vite-card-art.ts';

// 단위 테스트는 Node 환경에서 실행합니다. (Worker 코드는 표준 Request/Response/Web Crypto만 사용)
export default defineConfig({
  plugins: [cardArtPlugin()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
