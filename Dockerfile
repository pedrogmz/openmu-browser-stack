# Node stack: static WASM client + WebSocket/TCP proxy.
# The WASM client files (public/Main.*, public/assets/) are not in git; build
# them with mu-main/build-wasm.ps1 (it deploys into public/) before building
# the image. scripts/publish-image.ps1 builds and pushes the image to GHCR.

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# /app must be writable by the node user (start-services.js writes proxy.log
# next to itself). Files are copied with --chown instead of a final
# "chown -R", which would duplicate the ~750 MB of game data in another layer.
RUN chown node:node /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R node:node node_modules

# Layers go from least to most frequently changed:
# 1. Game data buckets (~750 MB). Only rebuilt when Data/ or fonts/ change.
COPY --chown=node:node public/assets ./public/assets
# 2. Compiled client (Main.wasm ~27 MB, Main.js, Main.data) and page files.
COPY --chown=node:node public ./public
# 3. Proxy and web server code.
COPY --chown=node:node start-services.js ./
COPY --chown=node:node src ./src

USER node

ARG CLIENT_VERSION=unknown
LABEL org.opencontainers.image.source="https://github.com/pedrogmz/openmu-browser-stack" \
      org.opencontainers.image.description="OpenMU browser stack: WASM client + WebSocket/TCP proxy" \
      mu.client.version="${CLIENT_VERSION}"

# 8085 is the public HTTP entry point. 7100 is the internal WebSocket proxy;
# the web server forwards /ws to it and it does not need to be published.
EXPOSE 8085 7100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const tls=!!(process.env.TLS_CERT_PATH&&process.env.TLS_KEY_PATH);const m=tls?require('https'):require('http');m.get({host:'127.0.0.1',port:Number(process.env.WEB_PORT||8085),path:'/healthz',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "start-services.js"]
