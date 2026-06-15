# ── build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Keep prod + optional deps (Cloud Tasks / Secret Manager are optionalDependencies used in prod).
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Cloud Run sets PORT. Override CMD for Cloud Run Jobs:
#   poll-all   → node dist/scripts/poll-all.js
#   refresh    → node dist/scripts/refresh-tokens.js
#   backfill   → node dist/scripts/backfill.js --creator <id>
CMD ["node", "dist/server.js"]
