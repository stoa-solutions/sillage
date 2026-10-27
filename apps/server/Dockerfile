FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/core/package.json packages/core/package.json

# Bundles the TypeScript sources with esbuild; this stage keeps the development tools.
FROM base AS build
RUN npm ci --workspace=@playlist-recall/server --workspace=@playlist-recall/core --include-workspace-root=false --legacy-peer-deps
COPY packages/core packages/core
COPY apps/server/build.mjs apps/server/build.mjs
COPY apps/server/src apps/server/src
RUN npm run build -w @playlist-recall/server

# Runs the bundle with production dependencies only.
FROM base
RUN npm ci --omit=dev --workspace=@playlist-recall/server --workspace=@playlist-recall/core --include-workspace-root=false --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/drizzle apps/server/drizzle
USER node
ENV NODE_ENV=production MODEL_PATH=/models/ MODEL_THREADS=2
WORKDIR /app/apps/server
CMD ["node", "--enable-source-maps", "dist/boot.js"]
