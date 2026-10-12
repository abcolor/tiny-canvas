FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tinycanvas/db generate && pnpm --filter @tinycanvas/api build
# 產生只含 api 正式依賴的目錄
RUN pnpm --filter @tinycanvas/api deploy --prod /out \
  && mkdir -p /out/prisma && cp -r packages/db/prisma/* /out/prisma/

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
RUN ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
EXPOSE 3000
# 啟動時自動執行資料庫遷移
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && exec node dist/main.js"]
