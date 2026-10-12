FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tinycanvas/db generate && pnpm --filter @tinycanvas/sync build
RUN pnpm --filter @tinycanvas/sync deploy --prod /out \
  && mkdir -p /out/prisma && cp packages/db/prisma/schema.prisma /out/prisma/

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
RUN ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
EXPOSE 4000
CMD ["node", "dist/main.js"]
