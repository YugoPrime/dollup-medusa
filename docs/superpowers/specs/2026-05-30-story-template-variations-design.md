# 10 New Story Template Variations — Design

**Date:** 2026-05-30
**Author:** solo + Claude
**Status:** Approved scope, pending spec review
**Repo:** `Backend/dollup-medusa`

## Problem

The daily IG-Stories auto-pilot posts product stories that "feel too similar
every day" — same layout skeleton, same `rise`/`settle` entrance, same swatch
dots. The catalog of templates is large but visually converges: most are a
photo with a caption box below/beside it. We want genuinely different **layouts
and motions** across the buckets the picker already routes by: 1-color,
2-color, product-with-back-picture, cutout.

## Goal

Ship **10 new templates**, each a distinct layout *and* motion, wired into
`picker.ts` so they appear in the daily rotation. Hard-gate the back/cutout
templates so they only fire when the product genuinely has that image (never
render `Rs.0 / IS0000` garbage). Keep all 100+ existing picker unit tests green.

## Non-goals

- No engine changes to HyperFrames, the render daemon, or the publish pipeline.
- No new image-classification logic (reuse `classifyImageKind`, `pickFront`,
  `pickBack`, `pickCutout`).
- No palette siblings for the new templates in v1 (can add later like the
  existing `-blush/-cream/-sage/-coral` families).
- No JS in templates. Pure CSS only (the renderer screenshots each frame).

## Engine constraints (hard)

- A template = a folder under `src/story-templates/<slug>/` with `index.html`
  + `styles.css` + `meta.json` (+ generated `preview.jpg`).
- `index.html` root: `<div id="root" class="canvas" data-composition-id="main"
  data-start="0" data-duration="<N>" data-width="1080" data-height="1920">`.
- Image slots: `<img data-hf-image="SLOT_ID">`. Text slots: `data-hf-text="ID"`.
- Motion = pure CSS `@keyframes` / `animation` / `transition`. The renderer
  seeks to a fixed timestamp per screenshot, so **finite-period infinite loops
  are fine** (deterministic), but anything needing JS/scroll/`<video>` is not.
- `meta.json` is validated by `template-loader.ts`: `slug` must equal the folder
  name; `category` ∈ {single-product, single-product-multi-image, multi-product,
  editorial, ops}; `wave` ∈ {0,1,2,3}; each slot `hint` ∈ {front, back, detail,
  lifestyle, cutout, model} + `required:boolean`; each text override needs
  `id` + string `default` (may be "") + integer `max_chars ≥ 1`.
- Brand tokens (`_brand/tokens.css`): `--dub-cream #f5e6d8`, `--dub-pink
  #f4c2c2`, `--dub-blush #fde2e2`, `--dub-ink #2b2b2b`, `--dub-gold #c9a96e`,
  `--dub-soft #fff8f0`, `--dub-red`, `--dub-coral`, `--dub-sage`,
  `--dub-sage-deep`, `--dub-coral-soft`. Fonts: `--dub-font-display` (Playfair),
  `--dub-font-body` (Inter). `--story-w` / `--story-h`.
- **Universal brand rules** (from memory, apply to every template):
  - Product photo must be at **full opacity from frame 0** — no fade-in on
    photos. Animate text/overlays only. (Ken Burns scale/pan is allowed; it
    starts visible.)
  - **Always show size** when the product has sizes (every template that has a
    product surface renders a size override).
  - Include the `shop-chip` CTA block (Shop now → dollupboutique.com) consistent
    with existing templates, OR an equivalent on-brand CTA where the layout
    demands it (e.g. receipt "TEAR HERE → DM TO ORDER").

## The 10 templates

Each row: slug · bucket · image slots · signature. Full layout/motion detail
lives in the implementation plan; this table is the contract.

| # | slug | bucket | slots | text overrides | signature |
|---|------|--------|-------|----------------|-----------|
| 1 | `editorial-cover-hero` | 1-color | `hero` (front) | price, size, sku | Vogue masthead ON full-bleed photo + continuous Ken Burns |
| 2 | `split-thirds-editorial` | 1-color | `hero` (front) | headline(name), price, size, sku | hard 33/67 split, flat type-column + clip-path side-wipe + keyline draw |
| 3 | `receipt-tag-1color` | 1-color | `hero` (front) | headline(name), price, size, sku | thermal swing-tag that "prints" top-down + CSS barcode + TEAR HERE CTA |
| 4 | `framed-gallery-1color` | 1-color | `hero` (front) | headline(name), price, size, sku | matted museum hang + placard + blur focus-pull + frame-draw |
| 5 | `diagonal-2color-wipe` | 2-color | `front_a`, `front_b` | headline, price, size_a, size_b, sku, footer | diagonal seam split, both colors slide-meet on a gold seam |
| 6 | `swipe-through-2color` | 2-color | `front_a`, `front_b` | headline, price, size_a, size_b, sku, footer | full-bleed A→B slide-over swap under fixed text + width-tracking color bars |
| 7 | `cardflip-front-back` | 1-color+back | `front`, `back` | headline(name), price, size, sku | real 3D `rotateY` card-flip front→back with gold spine |
| 8 | `lookbook-spread-back` | 1-color+back | `front`, `back` | headline(name), price, size, sku | top/bottom shutter-meet at a gold hairline, equal 50/50 billing |
| 9 | `filmstrip-multiframe` | 1-color+back | `front`, `back` | headline(name), price, size, sku | vertical 35mm reel (CSS sprockets) advances in, front+back as 2 frames |
| 10 | `bigprice-cutout-hero` | cutout | `product_cutout` (cutout) | price, size, sku, headline(name) | 240px gold price breaks grid, cutout overlaps it, gold text-fill sweep |

Slot `id`s are chosen to match what the picker already injects so wiring is a
one-line rotation-pool add wherever possible:
- 1-color single-image templates use slot id **`hero`** (the single-image branch
  injects `{ hero: leadFront }`).
- 2-color templates use **`front_a` / `front_b`** (injected by the 2-color
  no-back branch).
- back templates use **`front` / `back`** (injected by the 1-color-front-back
  branch).
- cutout uses **`product_cutout`** (injected by the cutout branches).

## Picker wiring

`picker.ts` is the gatekeeper. Two edits per template family: add the slug to a
rotation pool, and add a `buildTextOverrides` switch arm. Specifics:

### 1-color single-image (templates 1–4)
Add all four slugs to `SINGLE_IMAGE_ROTATION`. They join the existing
least-used rotation for 1-color-no-back products. Add a `buildTextOverrides`
arm for each (price + size + sku, plus `headline`=product name for 2/3/4).
`MAX_TEMPLATE_PER_DAY = 2` cap already applies — good, prevents repeats.

**Reach:** every product has a front → these fire constantly. This is the bulk
of the daily-feed refresh.

### 2-color (templates 5–6)
The 2-color-no-back branch (`picker.ts:590`) currently always returns
`product-2colors-front`. Change it to round-robin a new pool
`TWO_COLOR_FRONT_ROTATION = [product-2colors-front, diagonal-2color-wipe,
swipe-through-2color]` (least-used when `pickedSoFar` present, else slotIndex).
Add `buildTextOverrides` arms (reuse the `product-2colors-front` shape:
price, per-color `size_a`/`size_b`, sku; `headline`/`footer` from defaults).

**Reach:** any product with 2+ in-stock colors and no usable back → fires often.

### back templates (7–9) — HARD-GATED
These require a real `-b` back shot. The existing 1-color-front-back branch
already only runs when `pickBack` returns a back, so adding the three slugs to
`ONE_COLOR_FRONT_BACK_ROTATION` is **inherently hard-gated** — the branch is
unreachable without a back. Add `buildTextOverrides` arms (price, size, sku,
`headline`=name). No new gate code needed; the branch *is* the gate.

**Reach:** only products with a `-b` upload. Rare today → these appear
occasionally, which is the intended "special when it happens" behavior.

### cutout (10) — HARD-GATED
Add `bigprice-cutout-hero` alongside `cutout-spotlight` / `cutout-spotlight-v2`
in BOTH places: the daily-cutout-guarantee rotation at the top of `pickTemplate`
**and** the single-image pool's cutout extension. The cutout branches only run
when `pickCutout` returns a transparent PNG → inherently hard-gated. Add a
`buildTextOverrides` arm (price, size, sku, `headline`=name).

**Reach:** only products with a transparent cutout PNG. Same reach as the
existing cutout-spotlight templates.

## Per-template motion notes (verified buildable, with the fixes from research)

1. **editorial-cover-hero** — Ken Burns `scale(1.08)→scale(1.16)` translate
   over full duration; masthead slides down `translateY(-120%)→0`; gold hairline
   grows via `clip-path: inset(0 100% 0 0)→inset(0)`; price/CTA fade up last.
   *Fix:* type scrim = soft top-down `linear-gradient(rgba(43,43,43,.45),
   transparent)` band behind the masthead third + subtle `text-shadow` — never a
   hard dark box. Photo at full opacity frame 0 (Ken Burns is scale only).
2. **split-thirds-editorial** — photo `clip-path inset(0 0 0 100%)→inset(0)`
   right-edge wipe; sage panel `translateX(-100%)→0`; keyline `scaleY(0)→1`
   transform-origin top; left-panel text per-line mask-rise staggered.
   *Fix:* default product name horizontal (vertical-rl is a later variant); cap
   `max_chars` ~18 and clamp font-size so text never exceeds 1920px.
3. **receipt-tag-1color** — photo focus-pull cold-open:
   `filter: blur(16px)→0` + scale settle, **opacity 1 at frame 0** (blur only,
   no opacity fade — honors the no-fade-on-photos rule); receipt "prints" via
   `clip-path inset(0 0 100% 0)→inset(0)` on stacked masked rows staggered;
   barcode = `repeating-linear-gradient` bars wiped in by clip-path. Slot id
   **`hero`**. The receipt is the animated element; the photo is only a blur
   focus-pull at opacity 1.
4. **framed-gallery-1color** — frame draws via `clip-path: inset(50% 50% 50%
   50%)→inset(0)` on a solid mat layer (inset interpolates cleanly); gold keyline
   = inner `box-shadow`; placard slides up; name `letter-spacing` tracking-in in
   a fixed-width `white-space:nowrap` centered container so no reflow. Photo:
   blur focus-pull at frame 0, opacity 1 (same decision as #3).
5. **diagonal-2color-wipe** — two triangles via `clip-path: polygon(...)`; A
   `translateX(-100%)→0`, B `translateX(100%)→0`, meet ~0.9s; gold seam = a
   rotated absolutely-positioned div revealed with `clip-path:inset()` /
   `scaleY()`. *Fix:* gloss pass = white→transparent linear-gradient band via
   opacity/translateX (or `mix-blend-mode:screen`), NOT `soft-light`. Photos at
   full opacity (slide-in, no fade).
6. **swipe-through-2color** — A is opacity-1 base at frame 0 (no fade); B
   `translateX(100%)→0` overshoot to −2% with leading-edge `box-shadow`; A
   parallaxes to `translateX(-7%)`; color BARS width-animate to track. Optional
   swipe-back so clip ends clean on A. Fixed `--dub-ink` text scrim throughout.
   *Differentiators from product-2colors-front locked in:* slide-OVER push (not
   clip wipe), persistent text scrim, width-animated bars (not dots).
7. **cardflip-front-back** — `perspective:1400px`; `.flipper`
   `transform-style:preserve-3d`; back face pre-rotated `rotateY(180deg)` +
   `backface-visibility:hidden`; `@keyframes flip` holds front 0–38%, dips
   `rotateY(90deg) scale(.96)` at 50%, holds back 62–100%; flip duration ≥0.6s
   so the edge-on band spans multiple frames. *Fix:* add a thin `--dub-gold`
   card-edge sliver (a spine face or gradient/box-shadow) so the edge-on frame
   reads as an intentional spine. Lower text band fades up independently.
8. **lookbook-spread-back** — halves meet at center: top `translateY(-100%)→0`,
   bottom `translateY(100%)→0`. *Fix:* either clean ease-out (no overshoot) so
   halves kiss at center, OR keep overshoot but render the gold hairline on TOP
   at full width from frame 0 (animate only its glint) to mask the seam; clamp
   travel so they don't overlap. Page badge pops; footer fades up.
9. **filmstrip-multiframe** — strip = flex column; sprocket holes =
   `repeating-radial-gradient` on black margins; whole strip
   `translateY(40%)→0` film-advance scroll-in (photos at full opacity, the
   strip moves); exposure-data text fades in; finite-period micro-drift
   (`3s ease-in-out alternate`, not random). *Fix:* HARD-require front AND back
   filled — never duplicate the front into the 2nd frame (looks like a bug). The
   picker branch gate guarantees this.
10. **bigprice-cutout-hero** — background radial glow breathes (finite alternate
    loop); 240px Playfair price tracks in (`letter-spacing -0.18em→0`); gold
    `background-clip:text` fill sweep (`background-position 100%→0`) one-shot
    with `fill-mode:both` ending on a held solid-gold fill; **`color:var(
    --dub-gold)` fallback** so frame 0 and all resting frames show a filled gold
    number; cutout rises from `translateY(40px)` then finite float. *Fix:* never
    combine `-webkit-text-stroke` with `background-clip:text` on the same element
    — fake any outline with `text-shadow`/pseudo-element.

## Testing strategy

- **Picker unit tests** (`picker.unit.spec.ts`): the critical safety net. Add
  tests that:
  - each new slug can be produced by the picker for a matching product
    (front-only → one of templates 1–4; 2-color-no-back → 5/6; front+back → 7–9;
    cutout → 10).
  - `buildTextOverrides` for each new slug returns non-default values (price ≠
    "Rs.0", sku ≠ "IS0000") — guards against the missing-switch-arm bug that hit
    on 2026-05-26.
  - back templates do NOT fire on a front-only product (hard-gate proof).
  - cutout template only fires when a cutout PNG exists.
  - the `MAX_TEMPLATE_PER_DAY` cap + least-used rotation still hold with the
    enlarged pools (no template appears 3× in a simulated day).
- **Template-loader validation**: a test (or the existing `listTemplates`
  smoke) that every new `meta.json` loads without throwing (slug matches folder,
  hints valid, overrides valid).
- **Visual smoke**: `yarn regen-previews <slug>` for each new slug to produce a
  `preview.jpg`, then eyeball. This is where motion-timing and the research
  "fixes" get validated against real Chromium rendering. The preview is a single
  frame, so also render a full MP4 for at least the 3 motion-heavy ones
  (cardflip, swipe-through, bigprice) to confirm the animation reads — using the
  admin Re-render path or a local render.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Missing `buildTextOverrides` arm → `Rs.0/IS0000` garbage (hit before) | Per-slug override test asserts non-default values; the existing `default:` branch already `console.warn`s |
| Card-flip 90° dead-frame flicker | gold spine + flip ≥0.6s so edge-on spans frames; smoke an MP4 |
| `background-clip:text` invisible frames | solid-gold `color` fallback + `fill-mode:both` held end state |
| `soft-light` gloss renders muddy | use white→transparent gradient / `screen` instead |
| Back templates dead-firing on backless products | picker branch is the gate (unreachable without `pickBack`) |
| Enlarged rotation pools break cap/round-robin tests | add simulated-day test asserting ≤2 per template |
| Photo fade-in violating brand no-fade rule | photos opacity 1 at frame 0 across all 10; only text/overlays/strip animate |

## Build order (tracer-bullet)

1. **One full vertical slice first:** build `editorial-cover-hero` end-to-end
   (folder + meta + picker arm + test + preview) to lock the pattern and prove
   the regen-preview loop works. Get a preview eyeballed.
2. Then the remaining three 1-color templates (2–4).
3. Then the two 2-color templates (5–6) + the `TWO_COLOR_FRONT_ROTATION` change.
4. Then the three back templates (7–9).
5. Then the cutout template (10).
6. Full `yarn test:unit` green + regen all 10 previews + MP4 smoke the 3
   motion-heavy ones.

Each slice keeps the whole picker test suite green before moving on.
