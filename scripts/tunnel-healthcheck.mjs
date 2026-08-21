// Real end-to-end health check for the coolify-db-tunnel SSH tunnel.
//
// Why this exists: ensure-tunnel.ps1 used to judge the tunnel healthy with
// `Test-NetConnection 127.0.0.1 -Port 5432`, which only proves the local
// ssh.exe is LISTENING. When the VPS reboots and Docker reshuffles the
// container subnet, ssh keeps listening happily and every forwarded channel
// dies with "connect failed: Connection refused" on the far side. The port
// check passed, the renderer ran, and Knex timed out five minutes later.
// This script actually speaks Postgres and Redis through the tunnel.
//
// Exit 0 = both reachable. Exit 1 = something is not.
// Reads DATABASE_URL / REDIS_URL from .env.local-render.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = join(scriptDir, "..")

function loadEnv(file) {
  const out = {}
  let raw
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

const env = loadEnv(join(rootDir, ".env.local-render"))
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL
const redisUrl = process.env.REDIS_URL || env.REDIS_URL

const TIMEOUT_MS = Number(process.env.TUNNEL_HEALTHCHECK_TIMEOUT_MS || 8000)
const failures = []

async function checkPostgres() {
  if (!databaseUrl) return failures.push("postgres: DATABASE_URL not set")
  const { default: pg } = await import("pg")
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: TIMEOUT_MS,
    // The tunnel terminates plaintext inside the SSH channel; the URL already
    // carries sslmode=disable, but be explicit so a stray env can't flip it.
    ssl: false,
  })
  try {
    await client.connect()
    await client.query("SELECT 1")
    console.log("[tunnel-healthcheck] postgres OK")
  } catch (err) {
    failures.push(`postgres: ${err.message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

async function checkRedis() {
  if (!redisUrl) return failures.push("redis: REDIS_URL not set")
  const { default: Redis } = await import("ioredis")
  const redis = new Redis(redisUrl, {
    connectTimeout: TIMEOUT_MS,
    commandTimeout: TIMEOUT_MS,
    maxRetriesPerRequest: 0,
    // One shot. Without this ioredis reconnects forever and the check hangs.
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  })
  redis.on("error", () => {})
  try {
    await redis.connect()
    const pong = await redis.ping()
    if (pong !== "PONG") throw new Error(`unexpected PING reply: ${pong}`)
    console.log("[tunnel-healthcheck] redis OK")
  } catch (err) {
    failures.push(`redis: ${err.message}`)
  } finally {
    redis.disconnect()
  }
}

// A hard ceiling so a half-open socket can never wedge a 5-min scheduler tick.
const guard = setTimeout(() => {
  console.error(`[tunnel-healthcheck] FAIL hard timeout after ${TIMEOUT_MS * 2}ms`)
  process.exit(1)
}, TIMEOUT_MS * 2)
guard.unref?.()

await checkPostgres()
await checkRedis()
clearTimeout(guard)

if (failures.length) {
  for (const f of failures) console.error(`[tunnel-healthcheck] FAIL ${f}`)
  process.exit(1)
}
console.log("[tunnel-healthcheck] tunnel healthy")
process.exit(0)
