import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// E2E 測試使用另一組埠（見 playwright.config.ts），避免與開發中的服務衝突
const webPort = Number(process.env.WEB_PORT ?? 5273);
const apiPort = Number(process.env.API_PORT ?? 3000);
const syncPort = Number(process.env.SYNC_PORT ?? 4000);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Yjs 必須只有一份，否則 instanceof 判斷與 y-prosemirror 綁定會失效（ProseMirror 由 pnpm 確保同版本只有一份）
    dedupe: ['yjs', 'react', 'react-dom'],
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false },
      '/sync': { target: `ws://localhost:${syncPort}`, ws: true, changeOrigin: false },
    },
  },
  preview: { port: webPort },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 3000 },
  worker: { format: 'es' },
});
