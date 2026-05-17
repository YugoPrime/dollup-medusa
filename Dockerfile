FROM node:22-bookworm-slim

WORKDIR /app

# System dependencies:
#   - ffmpeg: HyperFrames audio mix + final MP4 encode
#   - Chrome runtime libs: headless-shell needs glibc + a stack of X/font libs
#     (Alpine + musl can't run the prebuilt Chrome binary HyperFrames downloads,
#     which is why this image is Debian slim, not Alpine).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
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

# Install Node deps
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn install --immutable

# Pre-download chrome-headless-shell into HyperFrames' cache dir so the first
# render doesn't try to download Chrome at runtime (which fails on cold start
# and shows up as ENOENT spawning the binary). Cache location matches what
# HyperFrames probes for: /root/.cache/hyperframes/chrome
RUN PUPPETEER_CACHE_DIR=/root/.cache/hyperframes/chrome \
    npx -y @puppeteer/browsers install chrome-headless-shell@stable

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
