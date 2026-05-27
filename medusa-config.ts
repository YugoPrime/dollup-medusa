import { loadEnv, defineConfig, Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Auth providers: emailpass is always on; google is enabled only when its
// env vars are present so the backend boots cleanly without Google config.
const authProviders: { resolve: string; id: string; options?: Record<string, unknown> }[] = [
  { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
]

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  authProviders.push({
    resolve: "@medusajs/auth-google",
    id: "google",
    options: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    },
  })
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: {
        redisUrl: process.env.EVENTS_REDIS_URL || process.env.REDIS_URL,
      },
    },
    // locking-redis is only registered when a Redis URL is available so the
    // backend boots cleanly in test environments that have no Redis server.
    ...(process.env.LOCKING_REDIS_URL || process.env.REDIS_URL
      ? [
          {
            resolve: "@medusajs/medusa/locking",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/locking-redis",
                  id: "locking-redis",
                  is_default: true,
                  options: {
                    redisUrl:
                      process.env.LOCKING_REDIS_URL || process.env.REDIS_URL,
                  },
                },
              ],
            },
          },
        ]
      : []),
    {
      // System payment provider (COD) auto-registers as pp_system_default.
      resolve: "@medusajs/medusa/payment",
    },
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "@medusajs/fulfillment-manual",
            id: "manual",
          },
        ],
      },
    },
    // File storage. R2 (S3-compatible) is used in production so admin
    // product image uploads survive Coolify redeploys and horizontal scale.
    // Falls back to file-local when R2_* env vars aren't set, so dev still
    // works with a writable container disk.
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          ...(process.env.R2_ENDPOINT &&
          process.env.R2_BUCKET &&
          process.env.R2_ACCESS_KEY_ID &&
          process.env.R2_SECRET_ACCESS_KEY &&
          process.env.R2_PUBLIC_URL
            ? [
                {
                  resolve: "@medusajs/medusa/file-s3",
                  id: "s3",
                  options: {
                    file_url: process.env.R2_PUBLIC_URL,
                    access_key_id: process.env.R2_ACCESS_KEY_ID,
                    secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
                    // R2 ignores the region but the SDK requires the field;
                    // "auto" is Cloudflare's documented value.
                    region: "auto",
                    bucket: process.env.R2_BUCKET,
                    endpoint: process.env.R2_ENDPOINT,
                    // R2 needs path-style addressing — virtual-host-style
                    // (bucket.endpoint) doesn't work on the default workers
                    // domain.
                    additional_client_config: {
                      forcePathStyle: true,
                    },
                  },
                },
              ]
            : [
                {
                  resolve: "@medusajs/medusa/file-local",
                  id: "local",
                },
              ]),
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/auth",
      dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
      options: {
        providers: authProviders,
      },
    },
    // Custom Doll Rewards loyalty module — earns + ledger + redeem.
    {
      resolve: "./src/modules/loyalty",
    },
    {
      resolve: "./src/modules/stories",
    },
    {
      resolve: "./src/modules/stories-render",
    },
    {
      resolve: "./src/modules/store-config",
    },
    {
      resolve: "./src/modules/sourcing",
    },
    {
      resolve: "./src/modules/sourcing-settings",
    },
    {
      resolve: "./src/modules/preorder",
    },
    {
      resolve: "./src/modules/chat",
    },
    {
      resolve: "./src/modules/leads",
    },
    {
      resolve: "./src/modules/size-requests",
    },
    // Notification module — local 'feed' for admin UI + Resend for email.
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: {
              name: "Local Notification Provider",
              channels: ["feed"],
            },
          },
          ...(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL
            ? [
                {
                  resolve: "./src/modules/notification-resend",
                  id: "resend",
                  options: {
                    channels: ["email"],
                    api_key: process.env.RESEND_API_KEY,
                    from: process.env.RESEND_FROM_EMAIL,
                    from_name:
                      process.env.RESEND_FROM_NAME ?? "Doll Up Team",
                    reply_to:
                      process.env.RESEND_REPLY_TO ??
                      process.env.RESEND_FROM_EMAIL,
                  },
                },
              ]
            : []),
        ],
      },
    },
  ],
})
