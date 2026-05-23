import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  inspectPageAccessToken,
  isMetaIgConfigured,
  MetaIgError,
} from "../lib/meta-ig"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"

const SECOND = 1
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Tiered token-expiry watchdog. Runs once a day at 09:00 MU (05:00 UTC).
 *
 * Behaviour:
 *   - Calls Meta /debug_token to read `expires_at` of META_PAGE_ACCESS_TOKEN.
 *   - `expires_at === 0` means "never expires" — quiet success, no alert.
 *   - >14 days left  → silent.
 *   - 8-14 days left → silent (avoids early-noise; tipping point covered below).
 *   - ≤7 days left   → daily Telegram heads-up.
 *   - ≤24h left      → louder Telegram (🚨 emoji + ALL CAPS line).
 *   - Already expired / is_valid=false → loudest alert.
 *   - Any unexpected error (network, invalid app creds, etc.) → one alert
 *     so a silent failure doesn't mask a real expiry creeping up.
 *
 * Requires META_APP_ID + META_APP_SECRET in env (debug_token needs an app
 * access token to inspect a page access token). Without them the job logs
 * a single warning per run and exits — no Telegram noise.
 */
export default async function checkMetaTokenExpiry(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (!isMetaIgConfigured()) {
    logger.warn(
      "[meta-token-check] META_PAGE_ACCESS_TOKEN / META_IG_BUSINESS_ACCOUNT_ID missing — skipping",
    )
    return
  }

  let info: Awaited<ReturnType<typeof inspectPageAccessToken>>
  try {
    info = await inspectPageAccessToken()
  } catch (err) {
    const e = err as MetaIgError
    logger.error(`[meta-token-check] debug_token call failed: ${e.message}`)
    await sendTelegram(
      [
        "⚠️ <b>Meta token check failed</b>",
        "",
        `Could not read token expiry: ${escapeTelegramHtml(e.message)}`,
        e.fbtraceId ? `fbtrace_id: ${escapeTelegramHtml(e.fbtraceId)}` : null,
        "",
        "If this repeats for &gt;24h the next renewal warning could be silently lost.",
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    return
  }

  if (info == null) {
    logger.warn(
      "[meta-token-check] META_APP_ID / META_APP_SECRET missing — cannot inspect token expiry",
    )
    return
  }

  const now = Math.floor(Date.now() / 1000)

  if (!info.is_valid) {
    await sendTelegram(
      [
        "🚨 <b>META TOKEN IS INVALID</b>",
        "",
        "<code>META_PAGE_ACCESS_TOKEN</code> reports <b>is_valid=false</b>.",
        "IG Stories auto-publish is BROKEN until you renew it.",
        "",
        `Renew: <a href="${ADMIN_URL}">Open admin</a> → Settings → Meta`,
      ].join("\n"),
    )
    return
  }

  // expires_at = 0 → never expires (long-lived page token).
  // Still useful to check data_access_expires_at, which Meta uses to gate
  // off "Data Access Expiration" 90 days after the user re-auths.
  if (info.expires_at === 0) {
    const dax = info.data_access_expires_at
    if (dax && dax > 0) {
      const daysToDax = Math.floor((dax - now) / DAY)
      if (daysToDax <= 7) {
        await sendTelegram(
          [
            daysToDax <= 1
              ? "🚨 <b>META DATA-ACCESS EXPIRES IN &lt;24H</b>"
              : `⚠️ <b>Meta data-access expires in ${daysToDax} days</b>`,
            "",
            "Token itself is long-lived, but Meta's data-access window is closing.",
            `Re-auth via Meta App "DOLL UP OS" before <code>${escapeTelegramHtml(new Date(dax * 1000).toISOString())}</code>`,
            "",
            "Otherwise IG Stories publish + Pixel CAPI start 403'ing.",
          ].join("\n"),
        )
      }
    }
    return
  }

  const secondsLeft = info.expires_at - now
  const daysLeft = Math.floor(secondsLeft / DAY)
  const hoursLeft = Math.floor(secondsLeft / HOUR)
  const expiresAtIso = new Date(info.expires_at * 1000).toISOString()

  if (secondsLeft <= 0) {
    await sendTelegram(
      [
        "🚨 <b>META TOKEN HAS EXPIRED</b>",
        "",
        `<code>META_PAGE_ACCESS_TOKEN</code> expired at <code>${escapeTelegramHtml(expiresAtIso)}</code>.`,
        "IG Stories auto-publish is BROKEN.",
        "",
        "Run <code>src/scripts/setup-meta-token.mjs</code> or renew via Graph API Explorer, then update env in Coolify + redeploy.",
      ].join("\n"),
    )
    return
  }

  if (secondsLeft <= 1 * DAY) {
    await sendTelegram(
      [
        `🚨 <b>META TOKEN EXPIRES IN ${hoursLeft}H</b>`,
        "",
        `<code>${escapeTelegramHtml(expiresAtIso)}</code>`,
        "",
        "Renew TODAY or tomorrow's 18:00 plan creation + every IG Story publish will fail.",
      ].join("\n"),
    )
    return
  }

  if (secondsLeft <= 7 * DAY) {
    await sendTelegram(
      [
        `⚠️ <b>Meta token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}</b>`,
        "",
        `<code>${escapeTelegramHtml(expiresAtIso)}</code>`,
        "",
        "Renew this week:",
        "1. Graph API Explorer → User Token with required scopes",
        "2. Exchange for long-lived: <code>src/scripts/setup-meta-token.mjs</code>",
        "3. Update <code>META_PAGE_ACCESS_TOKEN</code> in Coolify env + redeploy",
      ].join("\n"),
    )
    return
  }

  // 8-14 days left → silent. >14 days → silent. Nothing to do.
  logger.info(
    `[meta-token-check] token healthy (${daysLeft} days left, expires ${expiresAtIso})`,
  )
}

export const config = {
  name: "check-meta-token-expiry",
  // 09:00 Mauritius (UTC+4) = 05:00 UTC. Once a day so Telegram doesn't get spammed.
  schedule: "0 5 * * *",
}
