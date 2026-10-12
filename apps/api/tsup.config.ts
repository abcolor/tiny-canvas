import { defineConfig } from 'tsup';

// 以 esbuild 打包；workspace 套件（TS 原始碼）一併打包進 dist，node_modules 維持外部依賴。
// esbuild 不支援 emitDecoratorMetadata，因此所有 Nest 依賴注入一律以 @Inject(Token) 明確指定。
export default defineConfig({
  entry: { main: 'src/main.ts', cli: 'src/cli.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@tinycanvas\//],
  // Nest 的選用套件（本專案未安裝）在執行期以 try/require 載入，不能讓 esbuild 解析
  external: [
    '@nestjs/microservices',
    '@nestjs/microservices/microservices-module',
    '@nestjs/websockets',
    '@nestjs/websockets/socket-module',
    'class-validator',
    'class-transformer',
    /^@fastify\//,
  ],
});
