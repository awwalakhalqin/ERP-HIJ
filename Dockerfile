# syntax=docker/dockerfile:1.7
#
# Satu Dockerfile, tiga tujuan:
#   dev      server API dalam mode watch, kode di-bind dari folder proyek
#   build    tampilan (dist/) dan server (dist-server/) dibuild sekali
#   runtime  image produksi: hanya hasil build dan dependensi produksi
#
# Penyimpanan tetap satu berkas SQLite (node-sqlite3-wasm, tanpa biner native).
# Datanya tidak pernah masuk image: hij.db tinggal di volume /data dan foto
# unggahan di volume /app/uploads.

ARG NODE_VERSION=20

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development \
    HIJ_MODE=test \
    DATA_DIR=/data \
    PORT=3001 \
    # Bind mount dari Windows/macOS tidak mengirim event berkas; tsx perlu polling.
    CHOKIDAR_USEPOLLING=1
COPY . .
COPY docker/entrypoint-dev.sh /usr/local/bin/entrypoint-dev.sh
# Clone di Windows dengan autocrlf mengubah skrip ke CRLF; sh menolak baris "\r".
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint-dev.sh \
 && chmod +x /usr/local/bin/entrypoint-dev.sh \
 && mkdir -p /data /app/uploads
EXPOSE 3001
ENTRYPOINT ["entrypoint-dev.sh"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"]

# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3001
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Template SPK/faktur dibaca server dari public/templates saat mencetak.
COPY --from=build /app/public ./public
RUN mkdir -p /data /app/uploads && chown -R node:node /data /app/uploads
USER node
EXPOSE 3001
VOLUME ["/data", "/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server.js"]
