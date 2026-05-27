# Pre-order bookmarklet — overnight execution handoff

**Date:** 2026-05-28 morning
**Status:** STOPPED at Task 1. Plan needs architectural revision before resuming.

## TL;DR

I started executing the plan, hit the parser task (Task 1), and discovered the **entire `gbProductSsrData` extraction strategy is built on a wrong assumption about SHEIN's current page structure**. SHEIN no longer ships `gbProductSsrData` — that's a stale field name from an older SHEIN. The real picture (verified live via Playwright on the 3 URLs you shared) is much simpler than the plan assumed. I reverted Task 1's commit and stopped before contaminating downstream tasks. Plan + spec need a 30-min revision before resuming.

## What I did

1. Read the plan, dispatched a subagent for Task 1 (SHEIN parser)
2. Subagent built `lib/shein-extract.ts` from the plan's `gbProductSsrData` strategy, committed `561576f`
3. After your message with 3 real URLs, I opened them in Playwright and probed for `gbProductSsrData` → **doesn't exist on any of them**
4. Captured real DOM/JSON-LD shape from all 3 URLs (probe JSON files at workspace root: `shein-shape-probe-1.json`, `shein-dom-probe-1.json`, `shein-dom-probe-2-aloruh.json`, `shein-color-probe-2.json`, `shein-probe-3-amorya.json`)
5. Reverted commit `561576f` (now `b8d2971` on master, **not pushed**)
6. Wrote this handoff

Plan and spec are still intact — no changes to the architecture docs. Only the implementation commit was reverted.

## What the probes revealed

### The plan was wrong about

- **`window.gbProductSsrData`** — not a real global on current SHEIN pages. The only `gb*` global with any data is `gbRawData`, which contains `{googleSEO, modules, canonicalInfo}` — nothing about products
- **`window.gbRawData.productIntroData`** — doesn't exist
- **`productIntroData.detail.salePrice.amount` / `relation_color[].goods_thumb`** — these field paths exist nowhere on the page
- **Multi-color per-page** — SHEIN's model is **one ProductGroup = one color**. There are no per-page color swatches with separate image lists. Your "front + back per color" requirement maps to: one Doll Up product per SHEIN URL, where the SHEIN URL provides 6-8 images of that single color

### What's actually on the page (canonical source)

`<script type="application/ld+json" id="goodsDetailSchema">` — server-rendered, present on every PDP, stable JSON-LD schema. Real example shape from URL 2 (Aloruh):

```json
{
  "@context": "https://schema.org/",
  "@type": "ProductGroup",
  "name": "Aloruh Women's Floral Print Ruched Halter Neck Mini Dress, …",
  "color": "Orange",
  "productGroupID": "z250321089996",
  "image": [
    "https://img.ltwebstatic.com/v4/j/pi/2026/03/30/89/…_thumbnail_900x.webp",
    "https://img.ltwebstatic.com/v4/j/pi/2026/04/20/e6/…_thumbnail_900x.webp",
    … 8 total
  ],
  "variesBy": ["https://schema.org/size"],
  "hasVariant": [
    {
      "@type": "Product",
      "sku": "I7mk5bepfoldvc",
      "size": "XS",
      "offers": {
        "price": "16.70",
        "priceCurrency": "USD",
        "availability": "https://schema.org/InStock"
      }
    },
    … XS / S / M / L
  ]
}
```

### URL-by-URL results

| URL | Title (h1) | Color (JSON-LD) | Sizes | Images | Price | Availability |
|---|---|---|---|---|---|---|
| Soleia (URL 1) | "Soleia Women's Colorful Tie Dye Floral Print …" | Multicolor | XS S M L XL | 7 | $0.00 (suppressed) | InStock |
| Aloruh (URL 2) | "Aloruh Women's Floral Print Ruched Halter Neck …" | Orange | XS S M L | 8 | $16.70 | InStock |
| Amorya (URL 3) | "Amorya Women's Elegant Floral Print Metal Decor …" | Multicolor | S M L XL | 7 | $21.30 | InStock |

**Soleia's $0.00 price** is the one wrinkle. JSON-LD doesn't always carry a real price — SHEIN suppresses it for some products / regions / SKUs. The DOM has the real price (the body text matched `$12.70`), but only after client-side hydration. The bookmarklet can read the DOM since it runs after hydration; the server-side cron can't.

### Server-side anti-bot

Every server-side curl (any User-Agent) got 302-redirected to `/risk/challenge?captcha_type=903`. The Playwright browser took ~5 seconds, then the challenge auto-resolved and the real page loaded. **The backend cron at `0 2 UTC` (06:00 MU) will almost certainly hit the same wall.** Your laptop-daemon fallback idea from the spec is the right answer if the cron strategy doesn't work.

## What needs to change in the plan

### Architecture pivots

1. **Parser becomes JSON-LD only.** Drop `gbProductSsrData` paths from `lib/shein-extract.ts` entirely. Read the `<script id="goodsDetailSchema">` block, JSON.parse it, extract from the ProductGroup shape. Much simpler, more reliable.

2. **One color per SHEIN URL.** Drop the `colors: [{name, images[]}]` array shape and revert to the simpler model: each SHEIN URL imports as ONE color × N sizes × N images. If you want multi-color, you click the bookmarklet on each SHEIN sibling URL separately. (Sibling color URLs are findable from the product page, but most products don't have any.) This is actually closer to SHEIN's own data model.

3. **Bookmarklet reads JSON-LD on the page, falls back to DOM for missing price.** Tiny script (~60 lines instead of ~150). Falls back to the document's body text to find `$XX.XX` when JSON-LD has `"0.00"`.

4. **Daily availability check uses JSON-LD `offers.availability`.** Iterate `hasVariant[]`, check if ANY has `InStock` → product is still available. If all are `OutOfStock` (or page returns 404), move to draft. Same Telegram alert logic.

5. **Anti-bot fallback.** Keep the server-side fetch attempt but design it to gracefully degrade: if 3+ consecutive products get blocked, send the circuit-break Telegram alert (already in plan) AND prepare for the laptop-daemon fallback. The laptop daemon would run on your old laptop, poll the backend for "URLs that need checking", open them in a real browser one-by-one, post the availability back. Same pattern as your existing local-stories-render daemon.

### Tasks that need rewriting

- **Task 1** — `shein-extract.ts` becomes JSON-LD only. Fixtures captured from real Playwright probes (we have the data — see probe JSON files).
- **Task 2** — `createPreorderProduct` helper: drop multi-color logic, simplify to single-color × N sizes × N images.
- **Task 4** — `PreorderProduct` type: revert `variants[i].metadata.image_urls` per-color. Per-product `images[]` is enough since one product = one color.
- **Tasks 5-7** — Storefront PDP: drop the color-swatch row + per-color gallery swap. Standard gallery showing all images for the one color. (Save complexity.)
- **Task 12** — Bookmarklet route validates JSON-LD-derived shape (single color).
- **Task 15** — Bookmarklet JS: ~60 lines, extracts only from JSON-LD.
- **Task 20** — Availability cron: parse JSON-LD from fetched HTML, check `hasVariant[*].offers.availability`.

### Tasks unaffected

- Token model + service (Tasks 9-11)
- Admin settings page UI (Tasks 16-17)
- Telegram message templates (Task 19)
- CORS update (Task 14)
- Phase 1/2/3 smoke checklists (Tasks 8, 13, 18, 22)

## Two questions for you

1. **Multi-color: drop or keep?** SHEIN's data model is one URL = one color. If "front + back for each color" still matters to you, the workflow becomes "click the bookmarklet on Red SHEIN URL → click on Blue SHEIN URL → click on Green SHEIN URL — three Doll Up products created, one per color". They'd be siblings, not variants of one product. Alternative: keep multi-color in the Doll Up data model but only fill it manually in the admin form (the bookmarklet always creates single-color products, and you optionally merge them later). My recommendation: **drop multi-color for v1**, ship the simpler path, revisit if customers want it.

2. **Server-side cron OR laptop daemon first?** Both are real options. Server-side will probably get blocked but it's cheap to try. Laptop daemon needs setup. My recommendation: **build server-side first** (cheap), monitor Telegram for the circuit-break alert, build laptop daemon only if the cron persistently fails for >3 days.

## Concrete next session

When you wake up:

1. Read this handoff
2. Answer the two questions above (or just say "your call, proceed")
3. I'll update the **spec** to reflect the JSON-LD-only architecture + single-color v1
4. I'll update the **plan** with revised tasks
5. Spawn subagents through the 22 tasks fresh, this time on solid ground

The probe data is captured (`shein-*.json` files at workspace root) so the new fixtures don't need a live SHEIN session.

## Current git state

```
Backend/dollup-medusa  master  b8d2971  (revert of Task 1, NOT pushed)
                                fdd8e13  docs(preorder): implementation plan  ← on origin
                                93a547d  docs(preorder): spec  ← on origin
```

Nothing on `origin/master` for the bookmarklet work — only the spec + plan docs are public. The reverted parser code never reached production.
