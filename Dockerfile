FROM node:20-alpine

WORKDIR /app

# Install system dependencies (FFmpeg for story video rendering)
RUN apk add --no-cache ffmpeg

# Install dependencies
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn install --immutable

# Copy source
COPY . .

# Build for production (backend + admin dashboard)
RUN yarn build

# Ensure admin build is in the expected location
RUN mkdir -p /app/public && \
    cp -r /app/.medusa/server/public/admin /app/public/admin 2>/dev/null || true

EXPOSE 9000

# Start script handles migrations + seed + server
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
