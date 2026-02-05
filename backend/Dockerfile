# DACN API backend for Fly.io
FROM node:20-slim AS base

WORKDIR /app

# Install deps (npm install works without package-lock.json; use npm ci when lockfile is committed)
# Build tools required for better-sqlite3 native module
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev

# Build
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Production image
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# /data is the Fly volume mount for SQLite (see fly.toml)
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "dist/index.js"]
