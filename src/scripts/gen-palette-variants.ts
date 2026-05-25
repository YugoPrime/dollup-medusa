/**
 * One-shot generator for round-1 palette variants of high-frequency story
 * templates. Spec: docs/superpowers/specs/2026-05-25-story-template-palette-variants-design.md
 *
 * Generates 16 sibling template folders (4 base templates × 4 palettes) under
 * src/story-templates/. Each variant copies its base index.html verbatim,
 * rewrites meta.json (slug + name only), and produces a recoloured styles.css
 * by applying per-template palette overrides.
 *
 * Safe to re-run: variant folders are overwritten, base templates are never
 * touched. Run with: yarn tsx src/scripts/gen-palette-variants.ts
 */
import fs from "node:fs"
import path from "node:path"

type PaletteSlug = "blush" | "cream" | "sage" | "coral"

type Palette = {
  slug: PaletteSlug
  human: string
  canvasBg: string
  panelBg: string
  borderAccent: string
  textInkVar: string
  chipBg: string
  chipText: string
}

const PALETTES: Record<PaletteSlug, Palette> = {
  blush: {
    slug: "blush",
    human: "Blush",
    canvasBg:
      "radial-gradient(circle at 30% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, var(--dub-blush) 0%, var(--dub-pink) 100%)",
    panelBg: "var(--dub-pink)",
    borderAccent: "var(--dub-cream)",
    textInkVar: "var(--dub-ink)",
    chipBg: "var(--dub-ink)",
    chipText: "var(--dub-cream)",
  },
  cream: {
    slug: "cream",
    human: "Cream",
    canvasBg:
      "radial-gradient(circle at 70% 12%, rgba(201,169,110,0.18) 0%, rgba(201,169,110,0) 60%), linear-gradient(180deg, var(--dub-soft) 0%, var(--dub-cream) 100%)",
    panelBg: "var(--dub-soft)",
    borderAccent: "var(--dub-gold)",
    textInkVar: "var(--dub-ink)",
    chipBg: "var(--dub-gold)",
    chipText: "var(--dub-ink)",
  },
  sage: {
    slug: "sage",
    human: "Sage",
    canvasBg:
      "radial-gradient(circle at 25% 18%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, var(--dub-sage) 0%, var(--dub-sage-deep) 100%)",
    panelBg: "var(--dub-sage)",
    borderAccent: "var(--dub-soft)",
    textInkVar: "var(--dub-ink)",
    chipBg: "var(--dub-ink)",
    chipText: "var(--dub-sage)",
  },
  coral: {
    slug: "coral",
    human: "Coral",
    canvasBg:
      "radial-gradient(circle at 75% 12%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, var(--dub-coral-soft) 0%, var(--dub-coral) 100%)",
    panelBg: "var(--dub-coral-soft)",
    borderAccent: "var(--dub-cream)",
    textInkVar: "var(--dub-ink)",
    chipBg: "var(--dub-ink)",
    chipText: "var(--dub-cream)",
  },
}

type BaseTemplate = {
  slug: string
  humanBase: string
  /** Per-template palette transform applied to styles.css */
  transform(css: string, palette: Palette): string
}

/**
 * Replace the canvas / wrapper background of product-1color (and 2colors,
 * which use the same pattern). The base has `.canvas { background: var(--dub-soft); }`.
 * We rewrite that single rule to the palette gradient and rebackground the
 * inner panel placeholders.
 */
/**
 * Replace the `background: ...` declaration inside a named CSS block. Handles
 * both single-line `background: var(--dub-soft);` and the multi-line form
 * `background:\n    radial-gradient(...),\n    var(--dub-soft);` that
 * product-1color-featured uses for the canvas.
 *
 * Pre-condition: each CSS block we target opens with `.selector {` and ends
 * with a closing `}`. We isolate the block's body, rewrite the first
 * `background: ...;` declaration in it, and splice the modified body back in.
 */
function rewriteBlockBackground(
  css: string,
  selector: string,
  newValue: string,
): string {
  const open = css.indexOf(`${selector} {`)
  if (open === -1) return css
  const blockStart = css.indexOf("{", open) + 1
  // Find the matching closing brace — none of the targeted blocks contain
  // nested braces so a simple search is enough.
  const blockEnd = css.indexOf("}", blockStart)
  if (blockEnd === -1) return css

  const head = css.slice(0, blockStart)
  const body = css.slice(blockStart, blockEnd)
  const tail = css.slice(blockEnd)

  const newBody = body.replace(
    /background:[\s\S]*?;/,
    `background: ${newValue};`,
  )
  return head + newBody + tail
}

function rewriteCanvasAndPanels(css: string, palette: Palette): string {
  let out = css

  // Panel placeholder backgrounds in the base: var(--dub-blush) is used on
  // .hero, .back-inset, .panel, .back-panel as the show-through color while
  // images load. Swap to the variant's panel color.
  out = out.replaceAll("var(--dub-blush)", palette.panelBg)

  // 1color back-inset border uses `var(--dub-cream, #fffaf3)` — swap to
  // palette border accent.
  out = out.replace(
    /border:\s*6px\s+solid\s+var\(--dub-cream,\s*#fffaf3\);/,
    `border: 6px solid ${palette.borderAccent};`,
  )

  // 2colors back-panel border uses var(--dub-soft) — swap to palette accent.
  out = out.replace(
    /border:\s*6px\s+solid\s+var\(--dub-soft\);/,
    `border: 6px solid ${palette.borderAccent};`,
  )

  // 1color-featured `.card { background: var(--dub-soft); }` — the inner
  // card wrapper recolors to the variant's panel. Block-scoped so the
  // replacement can't bleed past the closing `}`.
  out = rewriteBlockBackground(out, ".card", palette.panelBg)

  // Canvas background. The .canvas block uses either `background: var(--dub-soft);`
  // (1color, 2colors) or a multi-line `background:\n radial-gradient(...),\n
  // var(--dub-soft);` (1color-featured). Block-scoped rewrite handles both.
  out = rewriteBlockBackground(out, ".canvas", palette.canvasBg)

  return out
}

/**
 * new-drop-arch has hand-rolled hex colors throughout (#fff5ec gradient,
 * #f3ece2 arch fill, etc.) — not token-based. We do a targeted swap of the
 * canvas gradient + arch / bubble fills, leaving the pink kicker stamp and
 * gold divider untouched (those are the template's signature accents).
 */
function rewriteArch(css: string, palette: Palette): string {
  const archPaletteMap: Record<PaletteSlug, { gradient: string; arch: string; bubble: string; border: string }> = {
    blush: {
      gradient: "linear-gradient(160deg, var(--dub-blush) 0%, var(--dub-pink) 100%)",
      arch: "var(--dub-pink)",
      bubble: "var(--dub-pink)",
      border: "var(--dub-cream)",
    },
    cream: {
      gradient: "linear-gradient(160deg, #fff5ec 0%, #fbe7d6 55%, #f6dac4 100%)",
      arch: "#f3ece2",
      bubble: "#f3ece2",
      border: "#fdf6ec",
    },
    sage: {
      gradient: "linear-gradient(160deg, var(--dub-sage) 0%, var(--dub-sage-deep) 100%)",
      arch: "var(--dub-sage)",
      bubble: "var(--dub-sage)",
      border: "var(--dub-soft)",
    },
    coral: {
      gradient: "linear-gradient(160deg, var(--dub-coral-soft) 0%, var(--dub-coral) 100%)",
      arch: "var(--dub-coral-soft)",
      bubble: "var(--dub-coral-soft)",
      border: "var(--dub-cream)",
    },
  }
  const p = archPaletteMap[palette.slug]
  let out = css

  // Canvas gradient (the base has #fff5ec → #fbe7d6 → #f6dac4)
  out = out.replace(
    /background:\s*linear-gradient\(160deg,\s*#fff5ec\s*0%,\s*#fbe7d6\s*55%,\s*#f6dac4\s*100%\);/,
    `background: ${p.gradient};`,
  )

  // Silk decorative blobs — keep cream tones on cream variant, blend on others
  if (palette.slug !== "cream") {
    out = out.replace(/background:\s*#fff7ec;/g, `background: ${p.border};`)
    out = out.replace(/background:\s*#f7e1cb;/g, `background: ${p.arch};`)
  }

  // Arch fill + bubble fill (both #f3ece2 in base)
  if (palette.slug !== "cream") {
    out = out.replaceAll("#f3ece2", p.arch)
    out = out.replaceAll("#fdf6ec", p.border)
  }

  return out
}

const BASES: BaseTemplate[] = [
  {
    slug: "product-1color",
    humanBase: "Product · 1 Color (Big Front + Back Inset)",
    transform: rewriteCanvasAndPanels,
  },
  {
    slug: "product-1color-featured",
    humanBase: "Product · 1 Color Featured (Cream Card + Circle Back)",
    transform: rewriteCanvasAndPanels,
  },
  {
    slug: "new-drop-arch",
    humanBase: "New Drop · Pampas Arch",
    transform: rewriteArch,
  },
  {
    slug: "product-2colors",
    humanBase: "Product · 2 Colors (Split + Back Overlay)",
    transform: rewriteCanvasAndPanels,
  },
]

const TEMPLATES_DIR = path.resolve(__dirname, "../story-templates")

function readBase(slug: string): { html: string; css: string; meta: any } {
  const dir = path.join(TEMPLATES_DIR, slug)
  return {
    html: fs.readFileSync(path.join(dir, "index.html"), "utf8"),
    css: fs.readFileSync(path.join(dir, "styles.css"), "utf8"),
    meta: JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")),
  }
}

function writeVariant(
  base: BaseTemplate,
  palette: Palette,
  source: { html: string; css: string; meta: any },
): string {
  const variantSlug = `${base.slug}-${palette.slug}`
  const dir = path.join(TEMPLATES_DIR, variantSlug)
  fs.mkdirSync(dir, { recursive: true })

  // meta.json — only slug + name change. Everything else (slots, text_overrides,
  // duration, wave, category) is preserved verbatim so the picker contract is
  // identical to the base template.
  const meta = {
    ...source.meta,
    slug: variantSlug,
    name: `${base.humanBase} — ${palette.human}`,
  }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")

  // index.html copied verbatim — only the stylesheet path changes through the
  // sibling directory, not the markup. Anything that breaks on the variant
  // would also break on the base.
  fs.writeFileSync(path.join(dir, "index.html"), source.html)

  // styles.css — palette transform on the base CSS.
  const css = base.transform(source.css, palette)
  fs.writeFileSync(path.join(dir, "styles.css"), css)

  return variantSlug
}

function main(): void {
  const written: string[] = []
  for (const base of BASES) {
    const source = readBase(base.slug)
    for (const palette of Object.values(PALETTES)) {
      written.push(writeVariant(base, palette, source))
    }
  }
  console.log(`Generated ${written.length} variants:`)
  for (const slug of written) console.log(`  - ${slug}`)
}

main()
