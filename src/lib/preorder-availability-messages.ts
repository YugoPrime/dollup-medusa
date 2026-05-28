/**
 * Telegram message templates for the daily SHEIN availability check
 * (see src/jobs/preorder-availability-check.ts).
 *
 * Each template returns an HTML-formatted string ready to pass to
 * sendTelegram(). User-supplied strings (titles, handles, SHEIN URLs) are
 * escaped via escapeTelegramHtml so a stray "<" in a product title can't
 * break Telegram's HTML parser.
 */
import { escapeTelegramHtml } from "./telegram"

const STOREFRONT_URL =
  process.env.PREORDER_STOREFRONT_URL ?? "https://preorder.dollupboutique.com"

type ProductCtx = {
  title: string
  handle: string
  sheinUrl: string
}

export function outOfStockMessage(p: ProductCtx): string {
  return [
    "🚨 <b>Pre-order moved to draft — SHEIN sold out</b>",
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN: ${escapeTelegramHtml(p.sheinUrl)}`,
    `Was at: ${STOREFRONT_URL}/preorder/products/${escapeTelegramHtml(p.handle)}`,
  ].join("\n")
}

export function removedMessage(p: ProductCtx): string {
  return [
    "🚨 <b>Pre-order moved to draft — SHEIN URL returned 404 (removed)</b>",
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN (gone): ${escapeTelegramHtml(p.sheinUrl)}`,
  ].join("\n")
}

export function needsManualCheckMessage(
  p: ProductCtx,
  consecutiveFailures: number,
): string {
  return [
    `⚠️ <b>Pre-order needs manual check (${consecutiveFailures} failed daily checks)</b>`,
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN: ${escapeTelegramHtml(p.sheinUrl)}`,
    "",
    "Likely cause: anti-bot blocking. Open the SHEIN URL in your browser and run the bookmarklet manually to confirm the product is still available.",
  ].join("\n")
}

export function circuitBreakMessage(
  blocked: number,
  total: number,
  sampleTitles: string[],
): string {
  return [
    `🚨 <b>Daily SHEIN check tripped circuit breaker</b>`,
    "",
    `${blocked} of ${total} products got 403/429 from SHEIN (>30% threshold).`,
    "Did NOT move anything to draft — likely just temporary anti-bot block.",
    "",
    "Sample affected products:",
    ...sampleTitles.slice(0, 5).map((t) => `• ${escapeTelegramHtml(t)}`),
    "",
    "If this persists for 3+ days, switch to the local-laptop daemon fallback (see docs/LOCAL-AVAILABILITY-DAEMON-SETUP.md when it ships).",
  ].join("\n")
}
