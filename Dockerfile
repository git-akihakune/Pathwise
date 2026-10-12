FROM node:24-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @pathwise/worker build && pnpm --filter @pathwise/web build

FROM node:24-slim AS runtime
COPY --from=build /repo/apps/web/.next/standalone /app/web
COPY --from=build /repo/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=build /repo/apps/worker/dist /app/worker
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/pathwise /usr/local/bin/pathwise
RUN mkdir -p /var/lib/pathwise/secrets /var/lib/pathwise/files \
    && chown -R node:node /var/lib/pathwise
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
USER node
ENTRYPOINT ["/app/entrypoint.sh"]
