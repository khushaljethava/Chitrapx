# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/document/package.json packages/document/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @chitrapx/worker...
# Headless Chromium plus its system libraries, for exports.
RUN cd apps/worker && pnpm exec playwright install --with-deps chromium
COPY packages/db packages/db
COPY packages/document packages/document
COPY packages/assets packages/assets
COPY apps/worker apps/worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
# node is PID 1 so SIGTERM reaches the graceful shutdown handler directly.
CMD ["node", "--import", "tsx", "src/index.ts"]
