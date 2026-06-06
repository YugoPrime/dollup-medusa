/**
 * Daily SHEIN availability check for all published pre-order products.
 *
 * Runs 06:00 Mauritius (UTC+4) = 02:00 UTC, once per day. For each
 * `metadata.is_preorder=true && status=published` product:
 *
 *   1. Gather all distinct SHEIN URLs the product touches — the product-level
 *      `metadata.shein_url` plus each variant's `metadata.shein_url` (per-color
 *      siblings stored by the bookmarklet's create flow). A multi-color preorder
 *      with Color A sold out on SHEIN but Color B still in stock stays
 *      published — we only move the WHOLE product to draft when EVERY URL
 *      reports unavailable.
 *   2. Fetch each URL and classify via the JSON-LD parser:
 *        in-stock     — any variant has availability=InStock
 *        out-of-stock — all variants OutOfStock
 *        removed      — 404
 *        blocked      — 403/429 OR a /risk/challenge redirect (SHEIN anti-bot)
 *        parse-fail   — 200 OK but no goodsDetailSchema script
 *        network-error
 *   3. Branch:
 *        all out/removed → status=draft + Telegram alert
 *        any blocked     → bump shein_check_failures counter; after 3 consecutive
 *                          daily failures send a "needs manual check" Telegram
 *        in-stock        → reset shein_check_failures to 0
 *   4. Circuit-break: if >30% of the run got blocked, fire a single summary
 *      Telegram and do NOT trust any of the out-of-stock signals for the
 *      affected products (we already wouldn't have marked them — blocked
 *      doesn't move to draft — but the summary tells the owner the anti-bot
 *      wall is up so they can flip to the local-daemon fallback).
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import { extractJsonLd } from "../lib/shein-extract"
import { PlaywrightSheinFetcher, classifyFetchOutcome } from "../lib/shein-fetcher"
import {
  outOfStockMessage,
  removedMessage,
  needsManualCheckMessage,
  circuitBreakMessage,
} from "../lib/preorder-availability-messages"
import { sendTelegram } from "../lib/telegram"

const CIRCUIT_BREAK_THRESHOLD = 0.3 // 30%
const FAILURE_ALERT_THRESHOLD = 3

type ProductVariantRow = {
  id: string
  metadata: Record<string, any> | null
}

type ProductRow = {
  id: string
  title: string
  handle: string
  status: string
  metadata: Record<string, any> | null
  variants?: ProductVariantRow[] | null
}

type CheckResult =
  | { kind: "in-stock" }
  | { kind: "out-of-stock" }
  | { kind: "removed" }
  | { kind: "blocked"; status: number }
  | { kind: "network-error"; message: string }
  | { kind: "parse-fail" }

export default async function preorderAvailabilityCheck(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // SHEIN now requires a real browser (JS captcha). This sweep only runs where
  // a browser is available — the laptop daemon sets AVAILABILITY_SWEEP_ENABLED.
  // On Coolify the flag is unset, so the cron is an intentional no-op (it would
  // otherwise classify every product as "blocked").
  if (process.env.AVAILABILITY_SWEEP_ENABLED !== "true") {
    logger.info("[preorder-availability] skipped — no browser (set AVAILABILITY_SWEEP_ENABLED=true on the daemon host)")
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: rows } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "status",
      "metadata",
      "variants.id",
      "variants.metadata",
    ],
  })

  const preorderPublished = (rows as ProductRow[]).filter((p) => {
    const meta = p.metadata ?? {}
    return meta.is_preorder === true && p.status === "published"
  })

  logger.info(
    `[preorder-availability] checking ${preorderPublished.length} products`,
  )

  const fetcher = new PlaywrightSheinFetcher()

  let blocked = 0
  const blockedTitles: string[] = []
  const movedToDraft: string[] = []

  try {
  for (const p of preorderPublished) {
    // Gather product-level + every variant's SHEIN URL (per-color siblings).
    const productSheinUrl: string | undefined = p.metadata?.shein_url
    const variantUrls = (p.variants ?? [])
      .map((v) => v?.metadata?.shein_url)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
    const distinctUrls = Array.from(
      new Set(
        [productSheinUrl, ...variantUrls].filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        ),
      ),
    )

    if (distinctUrls.length === 0) {
      logger.warn(`[preorder-availability] ${p.id} has no SHEIN URL on product or variants`)
      continue
    }

    const results = await Promise.all(
      distinctUrls.map(async (u): Promise<CheckResult> => {
        try {
          return await checkSheinUrl(u, fetcher)
        } catch (err: any) {
          return {
            kind: "network-error",
            message: err?.message ?? String(err),
          }
        }
      }),
    )

    const anyInStock = results.some((r) => r.kind === "in-stock")
    const allOut =
      results.length > 0 &&
      results.every((r) => r.kind === "out-of-stock" || r.kind === "removed")
    const anyBlocked = results.some(
      (r) =>
        r.kind === "blocked" ||
        r.kind === "network-error" ||
        r.kind === "parse-fail",
    )
    // Representative URL for Telegram messages: prefer product-level; otherwise first variant URL.
    const primaryUrl = productSheinUrl ?? distinctUrls[0]

    if (anyInStock) {
      await updateProductsWorkflow(container as never).run({
        input: {
          selector: { id: p.id },
          update: {
            metadata: {
              ...(p.metadata ?? {}),
              last_shein_check: new Date().toISOString(),
              shein_check_failures: 0,
            },
          },
        },
      })
      continue
    }

    if (allOut) {
      // Distinguish "all 404 removed" vs "all out-of-stock" by checking if any
      // result kind was "removed" — that's the stronger signal.
      const allRemoved = results.every((r) => r.kind === "removed")
      await updateProductsWorkflow(container as never).run({
        input: {
          selector: { id: p.id },
          update: {
            status: "draft",
            metadata: {
              ...(p.metadata ?? {}),
              ...(allRemoved
                ? { shein_removed: true }
                : { shein_unavailable: true }),
              last_shein_check: new Date().toISOString(),
            },
          },
        },
      })
      movedToDraft.push(p.title)
      await sendTelegram(
        allRemoved
          ? removedMessage({
              title: p.title,
              handle: p.handle,
              sheinUrl: primaryUrl,
            })
          : outOfStockMessage({
              title: p.title,
              handle: p.handle,
              sheinUrl: primaryUrl,
            }),
      )
      continue
    }

    if (anyBlocked) {
      // blocked / network-error / parse-fail — bump failure counter.
      blocked++
      blockedTitles.push(p.title)
      const prevFailures: number = Number(
        p.metadata?.shein_check_failures ?? 0,
      )
      const newFailures = prevFailures + 1
      const lastFailureKind = results.find(
        (r) =>
          r.kind === "blocked" ||
          r.kind === "network-error" ||
          r.kind === "parse-fail",
      )?.kind
      await updateProductsWorkflow(container as never).run({
        input: {
          selector: { id: p.id },
          update: {
            metadata: {
              ...(p.metadata ?? {}),
              last_shein_check: new Date().toISOString(),
              shein_check_failures: newFailures,
              shein_last_failure_kind: lastFailureKind,
            },
          },
        },
      })
      if (newFailures >= FAILURE_ALERT_THRESHOLD) {
        await sendTelegram(
          needsManualCheckMessage(
            { title: p.title, handle: p.handle, sheinUrl: primaryUrl },
            newFailures,
          ),
        )
      }
      continue
    }

    // Should not reach here — every result kind is covered above. Defensive
    // log so a missed branch doesn't fail silently.
    logger.warn(
      `[preorder-availability] ${p.id} (${p.title}) fell through all branches; results=${JSON.stringify(results)}`,
    )
  }

  // Circuit-break check: if >30% got blocked in a single run, alert summary.
  if (
    preorderPublished.length > 0 &&
    blocked / preorderPublished.length > CIRCUIT_BREAK_THRESHOLD
  ) {
    await sendTelegram(
      circuitBreakMessage(blocked, preorderPublished.length, blockedTitles),
    )
  }

  logger.info(
    `[preorder-availability] done. moved-to-draft=${movedToDraft.length}, blocked=${blocked}`,
  )
  } finally {
    await fetcher.close()
  }
}

async function checkSheinUrl(
  url: string,
  fetcher: PlaywrightSheinFetcher,
): Promise<CheckResult> {
  // Browser-based fetch — SHEIN's JS captcha blocks plain fetch(). The fetcher
  // loads the PDP in real Chromium, lets the anti-bot challenge self-resolve,
  // and returns the rendered HTML + final status/URL.
  const raw = await fetcher.fetchPdp(url)
  const outcome = classifyFetchOutcome(raw)
  switch (outcome.kind) {
    case "removed":
      return { kind: "removed" }
    case "challenge":
      // Anti-bot wall (challenge redirect or 4xx/5xx behind it) — "blocked".
      return { kind: "blocked", status: raw.status }
    case "parse-fail":
      // 200 OK but no goodsDetailSchema — same as the old parse-fail branch.
      return { kind: "parse-fail" }
    case "ok": {
      const pg = extractJsonLd(raw.html)
      if (!pg) return { kind: "parse-fail" }
      // Available if any variant is InStock; out otherwise.
      const anyInStock = pg.hasVariant.some(
        (v) => v.offers.availability === "https://schema.org/InStock",
      )
      return anyInStock ? { kind: "in-stock" } : { kind: "out-of-stock" }
    }
  }
}

export const config = {
  name: "preorder-availability-check",
  // 06:00 Mauritius (UTC+4) = 02:00 UTC. Once daily.
  schedule: "0 2 * * *",
}
