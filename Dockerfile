# XR: Node.js 22 + bundled API/web app, no npm dependencies.
FROM node:22-alpine

RUN apk add --no-cache su-exec \
 && addgroup -S xr \
 && adduser -S xr -G xr

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

# Build-time ownership is useful locally; Railway's mounted volume is
# re-owned by the entrypoint at container start before dropping privileges.
RUN mkdir -p /data/backups \
 && chown -R xr:xr /data

EXPOSE 3000
ENTRYPOINT ["sh", "./scripts/railway-entrypoint.sh"]
CMD ["node", "src/server.js"]
