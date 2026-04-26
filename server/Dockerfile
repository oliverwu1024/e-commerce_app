# syntax=docker/dockerfile:1
#
# Two targets:
#   - dev    → tsx + nodemon hot reload with src/ bind-mounted from host.
#              Selected by docker-compose.yml via build.target=dev.
#   - runner → compiled dist/, drops root, ships prisma CLI for migrations.
#              Selected by docker-compose.prod.yml via build.target=runner.
#
FROM node:20.19-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev
COPY . .
RUN npx prisma generate
EXPOSE 5000
CMD ["npm", "run", "dev"]

FROM base AS builder
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20.19-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Full install (includes prisma CLI from devDependencies) so operators can
# run `docker compose -f docker-compose.prod.yml exec server npx prisma migrate deploy`
# on first deploy without a separate tooling image. ~150 MB larger than a
# dev-pruned install; acceptable for MVP.
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs app \
 && chown -R app:nodejs /app
USER app
EXPOSE 5000
CMD ["node", "dist/index.js"]
