# syntax=docker/dockerfile:1
#
# Two targets:
#   - dev    → next dev with src/ bind-mounted from host.
#              Selected by docker-compose.yml via build.target=dev.
#   - runner → next build + output:'standalone' minimal runtime.
#              Selected by docker-compose.prod.yml via build.target=runner.
#
FROM node:20.19-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20.19-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM node:20.19-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* env vars are baked into the client bundle at build time.
# Caller must pass --build-arg NEXT_PUBLIC_API_URL=https://api.example.com
# (docker-compose.prod.yml sets this via build.args) or the client will hit
# localhost.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM node:20.19-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# `output: 'standalone'` in next.config.ts emits a minimal self-contained
# server at .next/standalone. public/ and .next/static are excluded and must
# be copied alongside.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs app \
 && chown -R app:nodejs /app
USER app
EXPOSE 3000
CMD ["node", "server.js"]
