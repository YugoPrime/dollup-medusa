import { load } from "cheerio"
import { createHash } from "node:crypto"

export type OgFields = {
  title: string | null
  image: string | null
  description: string | null
}

export type ScrapeResult =
  | { ok: true; fields: OgFields }
  | { ok: false; reason: "fetch_failed" | "invalid_url" | "timeout" | "no_og_tags" }

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; value: ScrapeResult }>()

export function parseOgFromHtml(html: string): OgFields {
  const $ = load(html)
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim()
  const ogImage = $('meta[property="og:image"]').attr("content")?.trim()
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim()

  const titleFallback = $(".product-title-text").first().text().trim()
  const imageFallback = $(".detail-gallery-img img").first().attr("src")?.trim()

  const safe = (v: string | undefined) => (v && v.length > 0 ? v : null)

  return {
    title: safe(ogTitle) ?? safe(titleFallback) ?? null,
    image: safe(ogImage) ?? safe(imageFallback) ?? null,
    description: safe(ogDesc) ?? null,
  }
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  if (!isValidHttpUrl(url)) return { ok: false, reason: "invalid_url" }
  const key = createHash("sha256").update(url).digest("hex")
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5_000)
  let html: string
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    if (!r.ok) {
      const value: ScrapeResult = { ok: false, reason: "fetch_failed" }
      cache.set(key, { at: Date.now(), value })
      return value
    }
    html = await r.text()
  } catch (e) {
    const reason: ScrapeResult = {
      ok: false,
      reason:
        (e as { name?: string }).name === "AbortError"
          ? "timeout"
          : "fetch_failed",
    }
    cache.set(key, { at: Date.now(), value: reason })
    return reason
  } finally {
    clearTimeout(t)
  }

  const fields = parseOgFromHtml(html)
  if (!fields.title && !fields.image) {
    const value: ScrapeResult = { ok: false, reason: "no_og_tags" }
    cache.set(key, { at: Date.now(), value })
    return value
  }

  const value: ScrapeResult = { ok: true, fields }
  cache.set(key, { at: Date.now(), value })
  return value
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}
