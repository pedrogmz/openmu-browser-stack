# Node stack: static WASM client + WebSocket/TCP proxy.
# The WASM client files (public/Main.*) are not in git; copy them into public/
# before building the image.

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY start-services.js ./
COPY src ./src
COPY public ./public

RUN chown -R node:node /app
USER node

# 8085 is the public HTTP entry point. 7100 is the internal WebSocket proxy;
# the web server forwards /ws to it and it does not need to be published.
EXPOSE 8085 7100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const tls=!!(process.env.TLS_CERT_PATH&&process.env.TLS_KEY_PATH);const m=tls?require('https'):require('http');m.get({host:'127.0.0.1',port:Number(process.env.WEB_PORT||8085),path:'/healthz',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "start-services.js"]
