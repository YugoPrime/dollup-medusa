FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn .yarn
RUN yarn install --immutable 2>/dev/null || yarn install

# Copy source
COPY . .

# Build for production (backend + admin dashboard)
RUN yarn build

# Build admin dashboard (needs NODE_ENV=development for build tools)
ENV NODE_ENV=development
RUN npx medusa build --admin-only
ENV NODE_ENV=production

# Ensure admin build is in the expected location
RUN mkdir -p /app/public && \
    cp -r /app/.medusa/server/public/admin /app/public/admin 2>/dev/null || true

EXPOSE 9000

# Start script handles migrations + seed + server
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
