# Multi-stage build: build deps (native modules) -> runtime image
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-alpine
WORKDIR /app
# Copy installed deps from builder, then rebuild native module for target arch
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN npm rebuild better-sqlite3
ENV DB_PATH=/data/envmonitor.db
EXPOSE 3000
CMD ["node", "server.js"]
