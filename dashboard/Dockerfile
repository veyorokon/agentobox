FROM node:22-alpine AS base

WORKDIR /app

RUN corepack enable pnpm

COPY dashboard/package.json dashboard/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY dashboard/. .
COPY shared /shared

# --- Dev target (used by docker-compose.yml) ---
FROM base AS dev

EXPOSE 5051

CMD ["pnpm", "dev"]

# --- Production build ---
FROM base AS builder

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm build

# --- Production image ---
FROM node:22-alpine AS prod

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
