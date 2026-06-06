import { extractJsonLd } from "./shein-extract"

type PreviewFn = (usd: number) => Promise<{
  finalPriceMur: number
  fxRateUsed: number
} & Record<string, unknown>>

export type QuoteScrapePayload = {
  outcome: "quoted" | "failed" | "needs_manual"
  scraped_title?: string | null
  scraped_thumbnail?: string | null
  scraped_price_usd?: number | null
  color_options?: string[] | null
  size_options?: string[] | null
  all_in_price_mur?: number | null
  price_breakdown?: unknown
  fx_rate_used?: number | null
  settings_snapshot?: unknown
  last_error_kind?: string | null
}

/** SHEIN images are protocol-relative (//img...) or absolute (https://img...). Normalize to https. */
function normalizeImageUrl(raw: string | undefined): string | null {
  if (!raw) return null
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
  if (raw.startsWith("//")) return `https:${raw}`
  return raw
}

/**
 * Pure: rendered HTML -> a recordScrapeResult payload. previewPrice + the
 * settings snapshot are injected so this is unit-testable without a container.
 */
export async function buildQuotePayload(
  html: string,
  deps: { previewPrice: PreviewFn; settingsSnapshot: unknown },
): Promise<QuoteScrapePayload> {
  const pg = extractJsonLd(html)
  if (!pg) {
    return { outcome: "needs_manual", last_error_kind: "parse-fail" }
  }
  const inStock = pg.hasVariant.filter(
    (v) => v.offers.availability === "https://schema.org/InStock",
  )
  if (inStock.length === 0) {
    return { outcome: "failed", last_error_kind: "removed", scraped_title: pg.name }
  }
  // SHEIN lists each size as a variant at the same price; take the first.
  const usd = Number(inStock[0].offers.price)
  if (!Number.isFinite(usd) || usd <= 0) {
    return { outcome: "needs_manual", last_error_kind: "parse-fail", scraped_title: pg.name }
  }
  const preview = await deps.previewPrice(usd)
  const sizes = Array.from(new Set(inStock.map((v) => v.size)))
  return {
    outcome: "quoted",
    scraped_title: pg.name,
    scraped_thumbnail: normalizeImageUrl(pg.image[0]),
    scraped_price_usd: usd,
    color_options: pg.color ? [pg.color] : [],
    size_options: sizes,
    all_in_price_mur: preview.finalPriceMur,
    price_breakdown: preview,
    fx_rate_used: preview.fxRateUsed,
    settings_snapshot: deps.settingsSnapshot,
    last_error_kind: null,
  }
}
