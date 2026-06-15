# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t backend-uptime-api .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

# ---- Build stage: install workspace deps, generate Prisma client, compile ----
FROM base AS builder
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @backend-uptime/db run generate
RUN pnpm exec turbo run build --filter=@backend-uptime/api...

# ---- Runtime stage ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app

# pnpm uses symlinked node_modules; copying the whole workspace at the same
# path preserves the link graph. (Image-size optimization via `pnpm deploy`
# is tracked in docs/deployment.md.)
COPY --from=builder --chown=app:app /repo ./

USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "apps/api/dist/index.js"]
