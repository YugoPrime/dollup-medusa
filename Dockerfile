FROM node:22-bookworm-slim

WORKDIR /app

# System dependencies:
#   - ffmpeg: HyperFrames audio mix + final MP4 encode
#   - Chrome runtime libs: chrome-headless-shell needs the full X / GTK /
#     fontconfig / nss / atk stack to launch. We do NOT install Debian's
#     `chromium` package — that build is stripped of HeadlessExperimental
#     APIs that HyperFrames uses; pages crash with "Target closed" during
#     Page.captureScreenshot. We install upstream chrome-headless-shell
#     via @puppeteer/browsers instead (next RUN block).
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

# Install upstream chrome-headless-shell into /opt/headless-shell. Resolve
# whichever exact subdir @puppeteer/browsers produces (path includes the
# version number which we don't want to hard-code) and symlink the binary
# to /usr/local/bin so PRODUCER_HEADLESS_SHELL_PATH can be stable.
RUN PUPPETEER_CACHE_DIR=/opt/headless-shell \
      npx -y @puppeteer/browsers install chrome-headless-shell@stable && \
    SHELL_BIN=$(find /opt/headless-shell -type f -name 'chrome-headless-shell' -executable | head -1) && \
    test -x "$SHELL_BIN" && \
    ln -sf "$SHELL_BIN" /usr/local/bin/chrome-headless-shell

# Tell HyperFrames where to find the binary. hyperframes/dist/cli.js reads
# this env var first before probing its own cache path.
ENV PRODUCER_HEADLESS_SHELL_PATH=/usr/local/bin/chrome-headless-shell

# Install Node deps + immediately purge the yarn berry cache. The cache
# holds .zip copies of every installed package (~1.4GB on this project)
# which gets baked into the image layer and isn't needed at runtime.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn install --immutable && \
    rm -rf .yarn/cache /root/.yarn/berry/cache /root/.cache/yarn 2>/dev/null || true

# Copy source + build (backend + admin dashboard)
COPY . .
RUN yarn build && \
    rm -rf .yarn/cache /root/.yarn/berry/cache /root/.cache/yarn 2>/dev/null || true

# Ensure admin build is in the expected location
RUN mkdir -p /app/public && \
    cp -r /app/.medusa/server/public/admin /app/public/admin 2>/dev/null || true

EXPOSE 9000

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
