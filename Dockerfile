# ---- Stage 1: build the React dashboard ----
FROM node:24-bookworm-slim AS web
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
RUN npm run build

# ---- Stage 2: production image (Node.js + Debian Chromium + Bengali fonts) ----
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    TZ=Asia/Dhaka

# chromium: headless browser for rendering banners
# fonts-noto-core / fonts-beng: local Bengali fonts (fallback when Google Fonts cannot be reached)
# fonts-noto-color-emoji: emoji in banners
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-core \
      fonts-beng \
      fonts-noto-color-emoji \
      fonts-liberation \
      ca-certificates \
      tini \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY --from=web /app/client/dist ./client/dist

RUN mkdir -p public/banners && chown -R node:node /app/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
