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
      unzip \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install upstream chrome-headless-shell into /opt/headless-shell. The CLI
# uses --path (not PUPPETEER_CACHE_DIR — that env var is for the Puppeteer
# runtime framework, not the @puppeteer/browsers CLI). Resolve whichever
# exact subdir the install produced (path includes the version number which
# we don't want to hard-code) and symlink the binary to /usr/local/bin so
# PRODUCER_HEADLESS_SHELL_PATH can be stable across version bumps.
RUN npx -y @puppeteer/browsers install chrome-headless-shell@stable --path /opt/headless-shell && \
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

# Copy source + build (backend + admin dashboard).
# Bump Node's heap to 4GB — the admin Vite compile OOM'd at the 1.5GB default
# (Coolify build 2026-05-26, log line "Reached heap limit Allocation failed").
# Without this the admin build silently crashes mid-Vite, but `medusa build`
# still returns 0 because the backend compile finished first → Docker keeps
# going and ships an image with no admin/index.html, which then crash-loops
# in prod with "Could not find index.html in the admin build directory".
COPY . .
RUN NODE_OPTIONS="--max-old-space-size=4096" yarn build && \
    rm -rf .yarn/cache /root/.yarn/berry/cache /root/.cache/yarn 2>/dev/null || true

# Ensure admin build is in the expected location. Hard-fail the build if the
# admin static assets are missing — better to fail Docker build than ship a
# broken image that crash-loops in production.
RUN set -e; \
    mkdir -p /app/public; \
    if [ ! -f /app/.medusa/server/public/admin/index.html ]; then \
      echo "ERROR: /app/.medusa/server/public/admin/index.html is missing — admin compile likely OOM'd. Check the previous RUN step."; \
      exit 1; \
    fi; \
    cp -r /app/.medusa/server/public/admin /app/public/admin

EXPOSE 9000

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
