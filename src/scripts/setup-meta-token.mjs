#!/usr/bin/env node
/**
 * One-shot helper to set up Meta credentials for IG Stories auto-publish.
 * Standalone — does NOT boot the Medusa container (no Postgres / Redis
 * dependency). Just HTTP calls to Meta's Graph API.
 *
 * Takes a short-lived user access token (the kind Graph API Explorer hands
 * out by default), exchanges it for a long-lived user token, walks every
 * Page the user manages, prints each Page's NON-EXPIRING Page Access Token
 * and the linked IG Business Account ID. Output is formatted to paste
 * straight into Coolify env vars.
 *
 * Run (PowerShell, from Backend/dollup-medusa):
 *   $env:META_APP_SECRET="..."
 *   $env:META_SHORT_USER_TOKEN="..."
 *   node src/scripts/setup-meta-token.mjs
 */

const DEFAULT_APP_ID = "1396051052286039" // DOLL UP OS
const API_VERSION = process.env.META_API_VERSION ?? "v21.0"

async function fbGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/${path.replace(/^\//, "")}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const err = json?.error
    throw new Error(
      `Meta API ${res.status} on ${path}: ${err?.message ?? "unknown"}${err?.fbtrace_id ? ` (fbtrace ${err.fbtrace_id})` : ""}`,
    )
  }
  return json
}

const log = (msg) => process.stdout.write(`${msg}\n`)
const err = (msg) => process.stderr.write(`${msg}\n`)

async function main() {
  const appId = process.env.META_APP_ID ?? DEFAULT_APP_ID
  const appSecret = process.env.META_APP_SECRET
  const shortToken = process.env.META_SHORT_USER_TOKEN

  log("")
  log("[meta-setup] starting")
  log(`[meta-setup] META_APP_ID = ${appId}`)
  log(`[meta-setup] META_APP_SECRET = ${appSecret ? `set (${appSecret.length} chars)` : "MISSING"}`)
  log(`[meta-setup] META_SHORT_USER_TOKEN = ${shortToken ? `set (${shortToken.length} chars, starts ${shortToken.slice(0, 12)}...)` : "MISSING"}`)

  if (!appSecret || !shortToken) {
    err("")
    err("[meta-setup] Missing env vars. Set both in PowerShell:")
    err('[meta-setup]   $env:META_APP_SECRET="..."')
    err('[meta-setup]   $env:META_SHORT_USER_TOKEN="..."')
    err("[meta-setup] Then re-run: node src/scripts/setup-meta-token.mjs")
    process.exit(1)
  }

  log("")
  log("[meta-setup] [1/3] Exchanging short token for long-lived user token...")
  let longUserToken
  try {
    const longUser = await fbGet("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    })
    longUserToken = longUser.access_token
  } catch (e) {
    err(`[meta-setup] Token exchange failed: ${e.message}`)
    process.exit(1)
  }
  log(`[meta-setup] OK. Long-lived user token starts ${longUserToken.slice(0, 16)}...`)

  log("")
  log("[meta-setup] [2/3] Fetching pages with the long-lived token...")
  let pages
  try {
    const accounts = await fbGet("me/accounts", {
      access_token: longUserToken,
      limit: "50",
    })
    pages = accounts.data ?? []
  } catch (e) {
    err(`[meta-setup] me/accounts failed: ${e.message}`)
    process.exit(1)
  }

  if (pages.length === 0) {
    err("[meta-setup] No pages found for this user. Are you the admin of the Doll Up FB Page?")
    process.exit(1)
  }
  log(`[meta-setup] Found ${pages.length} page(s):`)
  for (const p of pages) log(`[meta-setup]   - ${p.name} (${p.id})`)

  log("")
  log("[meta-setup] [3/3] Fetching IG Business Account ID for each page...")
  const results = []
  for (const page of pages) {
    let igUserId = null
    let igUsername = null
    let field = "none"
    try {
      const info = await fbGet(page.id, {
        access_token: page.access_token,
        fields: "instagram_business_account,connected_instagram_account",
      })
      if (info.instagram_business_account?.id) {
        igUserId = info.instagram_business_account.id
        field = "instagram_business_account"
      } else if (info.connected_instagram_account?.id) {
        igUserId = info.connected_instagram_account.id
        field = "connected_instagram_account"
      }
      if (igUserId) {
        try {
          const profile = await fbGet(igUserId, {
            access_token: page.access_token,
            fields: "username",
          })
          igUsername = profile.username ?? null
        } catch {
          /* username read is best-effort */
        }
      }
    } catch (e) {
      err(`[meta-setup] page ${page.name}: ${e.message}`)
    }
    results.push({
      pageName: page.name,
      pageId: page.id,
      pageAccessToken: page.access_token,
      igUserId,
      igUsername,
      field,
    })
  }

  log("")
  log("[meta-setup] ============================================================")
  log("[meta-setup] RESULTS")
  log("[meta-setup] ============================================================")
  for (const r of results) {
    log(`[meta-setup] Page: ${r.pageName} (${r.pageId})`)
    log(`[meta-setup]   IG Business Account: ${r.igUserId ?? "(none — IG not linked or not Business/Creator)"}`)
    if (r.igUsername) log(`[meta-setup]   IG @username: @${r.igUsername}`)
    log(`[meta-setup]   Resolved via field: ${r.field}`)
  }

  const dollUp =
    results.find((r) => r.igUserId && /doll.?up/i.test(r.pageName)) ??
    results.find((r) => r.igUserId)

  if (!dollUp) {
    err("")
    err("[meta-setup] No page returned an IG Business Account ID.")
    err("[meta-setup] Check: the IG account is a Business/Creator account AND linked from FB Page → Linked accounts → Instagram.")
    process.exit(1)
  }

  log("")
  log("[meta-setup] ============================================================")
  log("[meta-setup] Coolify env vars (copy these to the Backend service):")
  log("[meta-setup] ============================================================")
  log(`META_APP_ID=${appId}`)
  log(`META_APP_SECRET=${appSecret}`)
  log(`META_IG_BUSINESS_ACCOUNT_ID=${dollUp.igUserId}`)
  log(`META_PAGE_ACCESS_TOKEN=${dollUp.pageAccessToken}`)
  log(`META_AUTO_PUBLISH=false   # flip to true after one manual "Publish to IG" works`)
  log("")
  log(`[meta-setup] Selected page: ${dollUp.pageName} → @${dollUp.igUsername ?? "?"}`)
  log("[meta-setup] ============================================================")
}

main().catch((e) => {
  err(`[meta-setup] unexpected error: ${e.message}`)
  process.exit(1)
})
