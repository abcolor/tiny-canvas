import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  server: { port: 5191, strictPort: true },
  logLevel: 'warn',
});
