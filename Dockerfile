# Golden Path: build with Bun, run on Node LTS (App Contract `run`/prod).
# Production deps are installed inside the Node image so native modules
# (@libsql/client) match the runtime, not the build image.

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["./node_modules/.bin/react-router-serve", "./build/server/index.js"]
