FROM node:22-bookworm-slim

WORKDIR /app

# System dependencies:
#   - ffmpeg: HyperFrames audio mix + final MP4 encode
#   - chromium + its runtime libs: HyperFrames renders templates via headless
#     Chrome. We use the system chromium package so we don't need to manage
#     Puppeteer's chrome-headless-shell download/cache path (HyperFrames
#     probes its own cache path that doesn't match Puppeteer's, so the
#     simpler answer is "give it a system Chrome and tell it where").
#   - The libxss / libnss / libgtk packages are dragged in transitively by
#     chromium on Bookworm — listing them explicitly so future image bumps
#     don't silently lose them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      wget \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Point HyperFrames at the system chromium so it doesn't probe its own
# puppeteer cache path (which doesn't get populated by `apt-get install`).
# Source: hyperframes/dist/cli.js reads `env("PRODUCER_HEADLESS_SHELL_PATH")`.
ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/bin/chromium

# Install Node deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn install --immutable

# Copy source + build (backend + admin dashboard)
COPY . .
RUN yarn build

# Ensure admin build is in the expected location
RUN mkdir -p /app/public && \
    cp -r /app/.medusa/server/public/admin /app/public/admin 2>/dev/null || true

EXPOSE 9000

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
