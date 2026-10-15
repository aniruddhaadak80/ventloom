# syntax=docker/dockerfile:1

# Stage 1: build the monorepo.
FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lockb* bun.lock* ./
COPY apps ./apps
COPY packages ./packages

# Only the web app is containerised; the polyglot services ship their own images.
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/web build

# Stage 2: run the production server.
FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app /app
RUN rm -rf /app/apps/web/node_modules/.cache /app/.turbo

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

USER bun
CMD ["bun", "run", "--cwd", "apps/web", "start"]
