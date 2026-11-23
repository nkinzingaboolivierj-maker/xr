# XR has zero npm dependencies, so the image is just Node + the source.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    XR_DB_FILE=/data/xr.db \
    XR_BACKUP_DIR=/data/backups \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Non-root user; /data is the ONLY writable path and must be a persistent volume.
RUN addgroup -S xr && adduser -S xr -G xr && mkdir -p /data && chown -R xr:xr /data
USER xr
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "src/server.js"]
