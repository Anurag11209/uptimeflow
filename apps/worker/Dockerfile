# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t backend-uptime-worker .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS builder
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY turbo.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --no-frozen-lockfile
RUN pnpm exec turbo run build --filter=@backend-uptime/worker...

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo ./
USER app
CMD ["node", "apps/worker/dist/index.js"]
