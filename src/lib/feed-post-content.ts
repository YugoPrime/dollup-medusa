import type { ProductSnapshot } from "../modules/stories/snapshot"

/**
 * Builds the media list + caption for a daily IG/FB *feed* post from a product
 * snapshot. No story template — we post the product's own photos directly.
 */

export const FEED_STOREFRONT_BASE_URL =
  process.env.STORIES_STOREFRONT_BASE_URL ?? "https://shop.dollupboutique.com"

// Instagram carousels accept 2–10 items; a single image posts as a plain photo.
export const IG_CAROUSEL_MAX = 10

const MUR = new Intl.NumberFormat("en-US", { useGrouping: true })

/**
 * A real product photo for the feed: drops the transparent `-cutout` PNGs
 * (used only by story templates) and anything that isn't an image URL.
 */
function isFeedPhoto(url: string): boolean {
  if (!url) return false
  const file = url.split("?")[0].split("#")[0].toLowerCase()
  if (file.includes("cutout")) return false
  return /\.(jpe?g|png|webp)$/.test(file)
}

function isJpeg(url: string): boolean {
  const file = url.split("?")[0].split("#")[0].toLowerCase()
  return /\.jpe?g$/.test(file)
}

/**
 * Ordered, deduped photo URLs for the carousel: walks the in-stock colors
 * (each already carries its front/back images in upload order) so the post
 * reads color-by-color. Instagram only accepts JPEG, so we prefer the JPEG
 * subset and fall back to the full real-photo set only if no JPEGs exist
 * (better to attempt than skip the day's post).
 */
export function selectFeedImages(
  snapshot: Pick<ProductSnapshot, "variants_in_stock">,
  max: number = IG_CAROUSEL_MAX,
): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const v of snapshot.variants_in_stock ?? []) {
    for (const url of v.image_urls ?? []) {
      if (!isFeedPhoto(url) || seen.has(url)) continue
      seen.add(url)
      ordered.push(url)
    }
  }
  const jpegs = ordered.filter(isJpeg)
  const chosen = jpegs.length > 0 ? jpegs : ordered
  return chosen.slice(0, Math.max(1, max))
}

export type FeedCaptionOptions = {
  /** Order/DM + shipping copy. Configurable so the owner can edit without code. */
  footer?: string
  /** Hashtag line appended last. */
  hashtags?: string
}

export const DEFAULT_FEED_FOOTER =
  "📲 DM us or comment to order\n🚚 Cash on delivery across Mauritius · Fast island-wide delivery"

export const DEFAULT_FEED_HASHTAGS =
  "#dollupboutique #mauritius #shopmauritius #fashionmauritius #moris"

/**
 * Caption including (per the brief): price, SKU/ref, sizes, colors, a DM/order
 * line, shipping info and the product link. Footer + hashtags are injectable so
 * they can be configured via env without a code change.
 */
export function buildFeedCaption(
  snapshot: Pick<
    ProductSnapshot,
    "name" | "handle" | "price_mur" | "compare_at_price_mur" | "variants_in_stock"
  >,
  opts: FeedCaptionOptions = {},
): string {
  const sizes = Array.from(
    new Set((snapshot.variants_in_stock ?? []).flatMap((v) => v.sizes ?? [])),
  ).filter(Boolean)
  const colors = Array.from(
    new Set(
      (snapshot.variants_in_stock ?? [])
        .map((v) => v.color)
        .filter((c): c is string => Boolean(c)),
    ),
  )
  // Ref = product handle in upper case (the boutique's IS#### reference). When
  // every in-stock variant shares one SKU stem we'd rather show that, but the
  // handle is the stable, always-present reference.
  const ref = (snapshot.handle ?? "").toUpperCase()

  const footer = opts.footer ?? DEFAULT_FEED_FOOTER
  const hashtags = opts.hashtags ?? DEFAULT_FEED_HASHTAGS

  const onSale =
    snapshot.compare_at_price_mur != null &&
    snapshot.compare_at_price_mur > snapshot.price_mur
  const priceLine = onSale
    ? `💰 Rs ${MUR.format(snapshot.price_mur)} (was Rs ${MUR.format(snapshot.compare_at_price_mur!)})`
    : `💰 Rs ${MUR.format(snapshot.price_mur)}`

  const lines: string[] = [snapshot.name, "", priceLine]
  if (ref) lines.push(`🏷️ Ref: ${ref}`)
  if (sizes.length) lines.push(`📏 Sizes: ${sizes.join(" · ")}`)
  if (colors.length) lines.push(`🎨 Colours: ${colors.join(" · ")}`)
  lines.push("")
  if (footer.trim()) lines.push(footer.trim())
  lines.push(`🔗 ${FEED_STOREFRONT_BASE_URL}/products/${snapshot.handle}`)
  if (hashtags.trim()) {
    lines.push("")
    lines.push(hashtags.trim())
  }
  return lines.join("\n")
}

/** Reads the configurable caption footer/hashtags from env (cron uses this). */
export function readFeedCaptionOptionsFromEnv(): FeedCaptionOptions {
  return {
    footer: process.env.FEED_POST_FOOTER || DEFAULT_FEED_FOOTER,
    hashtags: process.env.FEED_POST_HASHTAGS || DEFAULT_FEED_HASHTAGS,
  }
}
