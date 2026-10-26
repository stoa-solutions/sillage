FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --omit=dev --workspace=@playlist-recall/server --workspace=@playlist-recall/core --include-workspace-root=false --legacy-peer-deps && npm cache clean --force
COPY packages/core packages/core
COPY apps/server/src apps/server/src
USER node
ENV NODE_ENV=production MODEL_PATH=/models/ MODEL_THREADS=2
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/boot.ts"]
