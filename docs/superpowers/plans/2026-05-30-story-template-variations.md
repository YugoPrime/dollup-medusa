# 10 New Story Template Variations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 visually-distinct IG-Stories templates (layout + motion) across the picker's 1-color, 2-color, front+back, and cutout buckets, wired into the daily rotation, with back/cutout templates hard-gated to products that actually have those images.

**Architecture:** Each template is a self-contained folder (`index.html` + `styles.css` + `meta.json`) under `src/story-templates/`. Motion is pure CSS `@keyframes` (the HyperFrames renderer screenshots each frame at a fixed timestamp — no JS). The picker (`src/modules/stories-render/picker.ts`) is the single gatekeeper: a template only appears in the feed after its slug is added to a rotation pool AND it has a `buildTextOverrides` switch arm. Back/cutout templates are gated implicitly because their picker branches are unreachable without a `-b` back shot / cutout PNG.

**Tech Stack:** HTML + CSS (Playfair/Inter, `--dub-*` brand tokens), TypeScript picker, Jest unit tests, HyperFrames CLI for preview/render.

---

## Reference: the canonical template contract

Every `index.html` follows this skeleton (copy verbatim, change only the inner `.scene`):

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <!-- template-specific content -->
      </div>
    </div>
  </body>
</html>
```

The standard CTA block (reuse where the layout allows; some templates use a custom CTA):

```html
<a class="shop-chip" aria-label="Shop now at dollupboutique.com">
  <span class="shop-chip-label">Shop now</span>
  <span class="shop-chip-arrow" aria-hidden="true">&#8594;</span>
  <span class="shop-chip-url">dollupboutique.com</span>
</a>
```

Every `styles.css` starts with this reset (copy verbatim):

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-soft); }
.scene { position: absolute; inset: 0; }
```

**Brand rules baked into every template:**
- Product `<img>` is `opacity: 1` at frame 0 — never fade a photo in. Animate text/overlays/containers only. (Ken Burns scale/pan and blur focus-pull are allowed because they start visible.)
- Always render a size override when the product has sizes.
- Tokens available: `--dub-cream #f5e6d8`, `--dub-pink #f4c2c2`, `--dub-blush #fde2e2`, `--dub-ink #2b2b2b`, `--dub-gold #c9a96e`, `--dub-soft #fff8f0`, `--dub-red`, `--dub-coral`, `--dub-sage`, `--dub-sage-deep`, `--dub-coral-soft`; fonts `--dub-font-display` (Playfair), `--dub-font-body` (Inter); `--story-w` / `--story-h`.

**Commands:**
- Run picker tests: `yarn test:unit picker.unit.spec.ts`
- Run all unit tests: `yarn test:unit`
- Regenerate one preview: `yarn regen-previews <slug>`

**Slot id convention (must match what the picker injects):**
- 1-color single-image → slot id **`hero`**
- 2-color → **`front_a`**, **`front_b`**
- front+back → **`front`**, **`back`**
- cutout → **`product_cutout`**

---

## Task 1: Tracer bullet — `editorial-cover-hero` (1-color) end-to-end

This task locks the full pattern: folder → meta → picker wiring → test → preview. Subsequent tasks repeat it.

**Files:**
- Create: `src/story-templates/editorial-cover-hero/meta.json`
- Create: `src/story-templates/editorial-cover-hero/index.html`
- Create: `src/story-templates/editorial-cover-hero/styles.css`
- Modify: `src/modules/stories-render/picker.ts` (SINGLE_IMAGE_ROTATION + buildTextOverrides arm)
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing picker test**

Add to `picker.unit.spec.ts` inside `describe("pickTemplate", ...)`:

```ts
it("editorial-cover-hero is reachable and gets real overrides", () => {
  // Force the single-image pool by giving a 1-color, front-only, not-new product.
  const s = snapshot({
    name: "Linen Wrap Dress",
    price_mur: 1290,
    variants_in_stock: [color("pink", ["front"], { sku: "IS2364-M-P", sizes: ["S", "M", "L"] })],
    variant_in_stock_count: 1,
  })
  // Saturate the other single-image templates so least-used lands on ours.
  const picked = new Map<string, number>([
    ["in-stock-hero", 2],
    ["in-stock-hero-blush", 2],
    ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2],
    ["just-arrived-editorial", 2],
    ["split-thirds-editorial", 2],
    ["receipt-tag-1color", 2],
    ["framed-gallery-1color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result).not.toBeNull()
  expect(result!.template_slug).toBe("editorial-cover-hero")
  expect(result!.slot_inputs.hero).toBe("https://r2/pink.jpg")
  expect(result!.text_overrides.price).toBe("Rs.1290")
  expect(result!.text_overrides.sku).toBe("IS2364")
  expect(result!.text_overrides.size).toContain("L")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit picker.unit.spec.ts -t "editorial-cover-hero is reachable"`
Expected: FAIL — `template_slug` is one of the existing slugs (or the new slugs aren't in the pool yet), not `editorial-cover-hero`.

- [ ] **Step 3: Wire the picker — add slug to SINGLE_IMAGE_ROTATION**

In `picker.ts`, extend the rotation (keep existing entries, append the four 1-color slugs from this plan):

```ts
const SINGLE_IMAGE_ROTATION = [
  "in-stock-hero",
  "in-stock-hero-blush",
  "lifestyle-overlay",
  "in-stock-hero-cream",
  "just-arrived-editorial",
  "editorial-cover-hero",
  "split-thirds-editorial",
  "receipt-tag-1color",
  "framed-gallery-1color",
] as const
```

- [ ] **Step 4: Add the buildTextOverrides arm**

In `picker.ts`, the existing arm that handles `"in-stock-hero"` etc. returns `{ price, size, sku }`. `editorial-cover-hero` needs exactly that shape. Add `"editorial-cover-hero"` as a new `case` label to the existing in-stock-hero arm (it already produces price+size+sku):

```ts
    case "in-stock-hero":
    case "in-stock-hero-blush":
    case "in-stock-hero-cream":
    case "editorial-cover-hero": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test:unit picker.unit.spec.ts -t "editorial-cover-hero is reachable"`
Expected: PASS.

- [ ] **Step 6: Create `meta.json`**

`src/story-templates/editorial-cover-hero/meta.json`:

```json
{
  "slug": "editorial-cover-hero",
  "name": "Editorial Cover · Masthead Hero",
  "category": "single-product",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "hero", "hint": "front", "label": "Product photo", "required": true }
  ],
  "text_overrides": [
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 7: Create `index.html`**

`src/story-templates/editorial-cover-hero/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="hero"><img class="hero-img" data-hf-image="hero" alt="" /></div>
        <div class="masthead-scrim" aria-hidden="true"></div>
        <h1 class="masthead">DOLL UP</h1>
        <div class="lower">
          <div class="hairline" aria-hidden="true"></div>
          <div class="lower-row">
            <span class="size" data-hf-text="size">Size: S · M · L</span>
            <span class="price" data-hf-text="price">Rs.0</span>
          </div>
          <div class="cta-row">
            <span class="sku" data-hf-text="sku">IS0000</span>
            <a class="shop-chip" aria-label="Shop now at dollupboutique.com">
              <span class="shop-chip-label">Shop now</span>
              <span class="shop-chip-arrow" aria-hidden="true">&#8594;</span>
              <span class="shop-chip-url">dollupboutique.com</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 8: Create `styles.css`**

`src/story-templates/editorial-cover-hero/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-ink); }
.scene { position: absolute; inset: 0; overflow: hidden; }

/* Full-bleed hero with a continuous Ken Burns that never settles. Photo is
   opacity 1 from frame 0 (only scale/translate animate). */
.hero { position: absolute; inset: 0; }
.hero-img {
  width: 100%; height: 100%; object-fit: cover; display: block;
  transform-origin: 50% 38%;
  animation: kenburns 6s linear both;
}
@keyframes kenburns {
  from { transform: scale(1.08) translate(2%, -1%); }
  to   { transform: scale(1.16) translate(-2%, 1%); }
}

/* Soft gradient band behind the masthead — NEVER a hard dark box. */
.masthead-scrim {
  position: absolute; top: 0; left: 0; right: 0; height: 38%;
  background: linear-gradient(to bottom, rgba(43,43,43,.5), rgba(43,43,43,0));
}

.masthead {
  position: absolute; top: 48px; left: 0; right: 0;
  text-align: center;
  font-family: var(--dub-font-display);
  font-weight: 800;
  font-size: 150px;
  letter-spacing: -2px;
  line-height: .92;
  color: var(--dub-soft);
  text-shadow: 0 6px 24px rgba(43,43,43,.45);
  animation: mastheadDrop .9s cubic-bezier(.16,1,.3,1) both;
}
@keyframes mastheadDrop {
  from { transform: translateY(-120%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}

.lower { position: absolute; left: 50px; right: 50px; bottom: 70px; }
.hairline {
  height: 2px; background: var(--dub-gold); margin-bottom: 26px;
  clip-path: inset(0 100% 0 0);
  animation: drawLine .6s ease-out 1.0s both;
}
@keyframes drawLine { to { clip-path: inset(0 0 0 0); } }

.lower-row { display: flex; align-items: baseline; justify-content: space-between; }
.size {
  font-family: var(--dub-font-body); font-weight: 700; font-size: 30px;
  letter-spacing: 2px; color: var(--dub-soft);
  animation: rise .5s ease-out 1.8s both;
}
.price {
  font-family: var(--dub-font-display); font-weight: 700; font-size: 96px;
  color: var(--dub-soft); line-height: 1;
  animation: rise .5s ease-out 1.8s both;
}
.cta-row { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; }
.sku {
  font-family: var(--dub-font-body); font-weight: 600; font-size: 22px;
  letter-spacing: 3px; color: var(--dub-soft); opacity: .85;
  animation: rise .5s ease-out 2.0s both;
}
.shop-chip {
  display: inline-flex; align-items: baseline; gap: 14px;
  font-family: var(--dub-font-display); font-style: italic; font-weight: 600;
  font-size: 34px; color: var(--dub-soft);
  animation: rise .5s ease-out 2.0s both;
}
.shop-chip-arrow {
  font-family: var(--dub-font-body); font-size: 38px;
  animation: arrowSlide 1.8s ease-in-out 2.4s infinite;
}
.shop-chip-url {
  font-family: var(--dub-font-body); font-style: normal; font-weight: 500;
  font-size: 24px; letter-spacing: 2px; opacity: .8;
}

@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes arrowSlide { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(12px); } }
```

- [ ] **Step 9: Verify meta loads + generate preview**

Run: `yarn regen-previews editorial-cover-hero`
Expected: completes without `meta.json invalid` errors and writes `src/story-templates/editorial-cover-hero/preview.jpg`. Open the jpg and confirm: full-bleed photo, big serif "DOLL UP" masthead over the top with a soft (not boxy) scrim, gold hairline, price/size/CTA at the bottom in cream.

- [ ] **Step 10: Run the full picker suite (no regressions)**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS — all existing tests still green with the enlarged `SINGLE_IMAGE_ROTATION`.

- [ ] **Step 11: Commit**

```bash
git add src/story-templates/editorial-cover-hero src/modules/stories-render/picker.ts src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add editorial-cover-hero template (1-color masthead)"
```

---

## Task 2: `split-thirds-editorial` (1-color)

Slug already added to `SINGLE_IMAGE_ROTATION` in Task 1. This task adds the folder, the `headline` text override (product name), and a test.

**Files:**
- Create: `src/story-templates/split-thirds-editorial/{meta.json,index.html,styles.css}`
- Modify: `src/modules/stories-render/picker.ts` (buildTextOverrides arm)
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing override test**

```ts
it("split-thirds-editorial gets headline=name + price + size", () => {
  const s = snapshot({
    name: "Ribbed Knit Top",
    price_mur: 850,
    variants_in_stock: [color("ecru", ["front"], { sku: "IS1900-M-E", sizes: ["S", "M"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
    ["editorial-cover-hero", 2], ["receipt-tag-1color", 2], ["framed-gallery-1color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("split-thirds-editorial")
  expect(result!.text_overrides.headline).toBe("Ribbed Knit Top")
  expect(result!.text_overrides.price).toBe("Rs.850")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit picker.unit.spec.ts -t "split-thirds-editorial gets headline"`
Expected: FAIL — `headline` is undefined (no switch arm yet; falls to `default:` warn → empty overrides).

- [ ] **Step 3: Add the buildTextOverrides arm**

In `picker.ts`, add a new arm (place near the new-drop-arch arm, which also sets `headline` from the name):

```ts
    case "split-thirds-editorial":
    case "receipt-tag-1color":
    case "framed-gallery-1color": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 22)
      if (sku) out.sku = sku
      return out
    }
```

(Templates 2, 3, and 4 share this exact shape, so they share one arm. `productNameLabel` already exists.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test:unit picker.unit.spec.ts -t "split-thirds-editorial gets headline"`
Expected: PASS.

- [ ] **Step 5: Create `meta.json`**

`src/story-templates/split-thirds-editorial/meta.json`:

```json
{
  "slug": "split-thirds-editorial",
  "name": "Editorial · Split Thirds",
  "category": "single-product",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "hero", "hint": "front", "label": "Product photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "NEW IN", "max_chars": 22 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 6: Create `index.html`**

`src/story-templates/split-thirds-editorial/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="photo"><img class="photo-img" data-hf-image="hero" alt="" /></div>
        <div class="keyline" aria-hidden="true"></div>
        <aside class="panel">
          <div class="panel-stack">
            <span class="kicker">DOLL UP</span>
            <h1 class="name"><span class="line" data-hf-text="headline">NEW IN</span></h1>
            <span class="price" data-hf-text="price">Rs.0</span>
            <span class="size" data-hf-text="size">Size: S · M · L</span>
            <span class="sku" data-hf-text="sku">IS0000</span>
            <a class="cta">DM TO ORDER &#8594;</a>
          </div>
        </aside>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 7: Create `styles.css`**

`src/story-templates/split-thirds-editorial/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-sage); }
.scene { position: absolute; inset: 0; }

/* Right 67% = full-height photo, wipes in from the right edge (opacity 1). */
.photo { position: absolute; top: 0; right: 0; bottom: 0; width: 67%; overflow: hidden;
  clip-path: inset(0 0 0 100%); animation: wipeIn .8s ease-out both; }
@keyframes wipeIn { to { clip-path: inset(0 0 0 0); } }
.photo-img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Left 33% flat sage panel. */
.panel { position: absolute; top: 0; left: 0; bottom: 0; width: 33%;
  background: var(--dub-sage); animation: panelIn .8s ease-out both; }
@keyframes panelIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }

.keyline { position: absolute; top: 0; bottom: 0; left: 33%; width: 2px; background: var(--dub-gold);
  transform-origin: top; transform: scaleY(0); animation: drawKey .4s ease-out .8s both; }
@keyframes drawKey { to { transform: scaleY(1); } }

.panel-stack { position: absolute; left: 40px; right: 24px; bottom: 70px;
  display: flex; flex-direction: column; gap: 22px; }
.kicker { font-family: var(--dub-font-body); font-weight: 700; font-size: 22px; letter-spacing: 6px;
  color: var(--dub-ink); opacity: .7; }
.name { font-family: var(--dub-font-display); font-weight: 800; font-size: 64px; line-height: 1.02;
  color: var(--dub-ink); overflow: hidden; }
/* per-line mask rise */
.name .line { display: block; transform: translateY(110%); animation: lineRise .6s cubic-bezier(.16,1,.3,1) 1.1s both; }
@keyframes lineRise { to { transform: translateY(0); } }
.price { font-family: var(--dub-font-display); font-weight: 700; font-size: 84px; color: var(--dub-gold);
  line-height: 1; animation: rise .5s ease-out 1.35s both; }
.size { font-family: var(--dub-font-body); font-weight: 700; font-size: 28px; letter-spacing: 2px;
  color: var(--dub-ink); animation: rise .5s ease-out 1.5s both; }
.sku { font-family: var(--dub-font-body); font-weight: 600; font-size: 20px; letter-spacing: 3px;
  color: var(--dub-ink); opacity: .65; animation: rise .5s ease-out 1.6s both; }
.cta { font-family: var(--dub-font-display); font-style: italic; font-weight: 600; font-size: 32px;
  color: var(--dub-ink); animation: rise .5s ease-out 1.7s both; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 8: Generate preview + eyeball**

Run: `yarn regen-previews split-thirds-editorial`
Expected: writes `preview.jpg`. Confirm: hard left sage column with stacked text, full-height photo on the right, gold keyline between.

- [ ] **Step 9: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/story-templates/split-thirds-editorial src/modules/stories-render/picker.ts src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add split-thirds-editorial template (1-color)"
```

---

## Task 3: `receipt-tag-1color` (1-color)

Slug already in `SINGLE_IMAGE_ROTATION` (Task 1) and override arm (Task 2, shared). This task is folder + a reachability test.

**Files:**
- Create: `src/story-templates/receipt-tag-1color/{meta.json,index.html,styles.css}`
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("receipt-tag-1color renders with hero slot + real overrides", () => {
  const s = snapshot({
    name: "Satin Slip",
    price_mur: 1100,
    variants_in_stock: [color("noir", ["front"], { sku: "IS2200-M-N", sizes: ["S", "M", "L"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
    ["editorial-cover-hero", 2], ["split-thirds-editorial", 2], ["framed-gallery-1color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("receipt-tag-1color")
  expect(result!.slot_inputs.hero).toBe("https://r2/noir.jpg")
  expect(result!.text_overrides.headline).toBe("Satin Slip")
  expect(result!.text_overrides.price).toBe("Rs.1100")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit picker.unit.spec.ts -t "receipt-tag-1color renders"`
Expected: FAIL — least-used currently can't land here only if folder/overrides missing; with the shared arm from Task 2 the slug resolves but the test asserts exact slug — if Task 2 arm is in place this may already pass on the picker side. The point of this test is to pin the slug + slot. If it passes immediately, that's fine; proceed to build the folder so `regen-previews` works.

- [ ] **Step 3: Create `meta.json`**

`src/story-templates/receipt-tag-1color/meta.json`:

```json
{
  "slug": "receipt-tag-1color",
  "name": "Swing Tag · Receipt",
  "category": "single-product",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "hero", "hint": "front", "label": "Product photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "THE PIECE", "max_chars": 22 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 4: Create `index.html`**

`src/story-templates/receipt-tag-1color/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="photo-window"><img class="photo-img" data-hf-image="hero" alt="" /></div>
        <div class="receipt">
          <div class="tear" aria-hidden="true"></div>
          <div class="r-row r1"><span class="r-key">STYLE</span><span class="r-dots"></span><span class="r-val" data-hf-text="headline">THE PIECE</span></div>
          <div class="r-row r2"><span class="r-key">SIZE</span><span class="r-dots"></span><span class="r-val" data-hf-text="size">S · M · L</span></div>
          <div class="r-row r3"><span class="r-key">PRICE</span><span class="r-dots"></span><span class="r-val gold" data-hf-text="price">Rs.0</span></div>
          <div class="barcode" aria-hidden="true"></div>
          <div class="r-sku" data-hf-text="sku">IS0000</div>
          <div class="r-footer">&#9733; DOLL UP &#9733;</div>
          <div class="r-cta">TEAR HERE &#8594; DM TO ORDER</div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: Create `styles.css`**

`src/story-templates/receipt-tag-1color/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-cream); }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; }

/* Photo: opacity 1, blur focus-pull only (no opacity fade). */
.photo-window { height: 58%; margin: 40px 40px 0; border-radius: 18px; overflow: hidden;
  background: var(--dub-blush); box-shadow: 0 20px 40px rgba(43,43,43,.14); }
.photo-img { width: 100%; height: 100%; object-fit: cover; display: block;
  animation: focusPull .8s ease-out both; }
@keyframes focusPull { from { filter: blur(16px); transform: scale(1.05); } to { filter: blur(0); transform: scale(1); } }

.receipt { position: relative; flex: 1; margin: 26px 90px 60px; background: var(--dub-soft);
  padding: 46px 46px 30px; box-shadow: 0 16px 30px rgba(43,43,43,.12);
  display: flex; flex-direction: column; gap: 22px; }
.tear { position: absolute; top: 0; left: 0; right: 0; height: 0; border-top: 3px dashed var(--dub-ink); }

.r-row { display: flex; align-items: baseline; gap: 14px;
  font-family: var(--dub-font-body); font-weight: 600; font-size: 34px; color: var(--dub-ink);
  letter-spacing: 1px; clip-path: inset(0 0 100% 0); }
.r1 { animation: printRow .01s linear .9s both; }
.r2 { animation: printRow .01s linear 1.1s both; }
.r3 { animation: printRow .01s linear 1.3s both; }
@keyframes printRow { to { clip-path: inset(0 0 0 0); } }
.r-key { font-weight: 800; letter-spacing: 3px; }
.r-dots { flex: 1; border-bottom: 3px dotted rgba(43,43,43,.4); transform: translateY(-8px); }
.r-val { font-weight: 700; }
.r-val.gold { color: var(--dub-gold); font-family: var(--dub-font-display); font-size: 44px; }

.barcode { height: 90px; margin-top: 8px;
  background: repeating-linear-gradient(90deg, var(--dub-ink) 0, var(--dub-ink) 4px, transparent 4px, transparent 9px);
  clip-path: inset(0 100% 0 0); animation: drawBar .5s ease-out 1.5s both; }
@keyframes drawBar { to { clip-path: inset(0 0 0 0); } }
.r-sku { font-family: var(--dub-font-body); font-weight: 600; font-size: 24px; letter-spacing: 6px;
  text-align: center; color: var(--dub-ink); opacity: .8; }
.r-footer { font-family: var(--dub-font-display); font-style: italic; font-size: 30px; text-align: center; color: var(--dub-ink); }
.r-cta { margin-top: auto; text-align: center; font-family: var(--dub-font-body); font-weight: 800;
  font-size: 28px; letter-spacing: 2px; color: var(--dub-ink); border-top: 3px dashed var(--dub-ink); padding-top: 18px; }
```

- [ ] **Step 6: Generate preview + eyeball**

Run: `yarn regen-previews receipt-tag-1color`
Expected: framed photo top, receipt with STYLE/SIZE/PRICE dotted rows, barcode, dashed tear edges, TEAR HERE CTA.

- [ ] **Step 7: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/story-templates/receipt-tag-1color src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add receipt-tag-1color template (1-color)"
```

---

## Task 4: `framed-gallery-1color` (1-color)

Slug already in pool (Task 1) + override arm (Task 2, shared). Folder + reachability test.

**Files:**
- Create: `src/story-templates/framed-gallery-1color/{meta.json,index.html,styles.css}`
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("framed-gallery-1color is reachable with name + price", () => {
  const s = snapshot({
    name: "Cotton Midi",
    price_mur: 990,
    variants_in_stock: [color("sage", ["front"], { sku: "IS2050-M-S", sizes: ["M", "L"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
    ["editorial-cover-hero", 2], ["split-thirds-editorial", 2], ["receipt-tag-1color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("framed-gallery-1color")
  expect(result!.text_overrides.headline).toBe("Cotton Midi")
  expect(result!.text_overrides.size).toContain("L")
})
```

- [ ] **Step 2: Run test to verify it fails (or passes if Task 2 arm covers it)**

Run: `yarn test:unit picker.unit.spec.ts -t "framed-gallery-1color is reachable"`
Expected: PASS on overrides (Task 2 arm covers the slug); proceed to build the folder.

- [ ] **Step 3: Create `meta.json`**

`src/story-templates/framed-gallery-1color/meta.json`:

```json
{
  "slug": "framed-gallery-1color",
  "name": "Gallery Print · Framed",
  "category": "single-product",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "hero", "hint": "front", "label": "Product photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "Untitled", "max_chars": 22 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 4: Create `index.html`**

`src/story-templates/framed-gallery-1color/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="wall" aria-hidden="true"></div>
        <div class="frame">
          <div class="mat">
            <div class="window"><img class="art" data-hf-image="hero" alt="" /></div>
          </div>
        </div>
        <div class="placard">
          <div class="placard-name" data-hf-text="headline">Untitled</div>
          <div class="placard-line"><span class="price" data-hf-text="price">Rs.0</span><span class="dot">·</span><span class="size" data-hf-text="size">Size: S · M · L</span></div>
          <div class="placard-sku" data-hf-text="sku">IS0000</div>
          <div class="placard-cta">DM TO ORDER &#8594; dollupboutique.com</div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: Create `styles.css`**

`src/story-templates/framed-gallery-1color/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-ink); }
.scene { position: absolute; inset: 0; }
.wall { position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 38%, #3a3a3a 0%, var(--dub-ink) 70%); }

.frame { position: absolute; top: 130px; left: 110px; right: 110px; height: 1180px;
  background: var(--dub-cream); padding: 90px;
  box-shadow: 0 40px 80px rgba(0,0,0,.5);
  /* gold keyline as inner shadow, not a 2nd clip target */
  outline: 2px solid var(--dub-gold); outline-offset: -78px; }
.mat { width: 100%; height: 100%; }
.window { width: 100%; height: 100%; overflow: hidden; }
/* mat frame-draws from center to edges; photo inside opacity 1 with blur focus-pull */
.frame { clip-path: inset(50% 50% 50% 50%); animation: frameDraw .7s ease-out .2s both; }
@keyframes frameDraw { to { clip-path: inset(0 0 0 0); } }
.art { width: 100%; height: 100%; object-fit: cover; display: block;
  animation: focusPull .85s ease-out both; }
@keyframes focusPull { from { filter: blur(18px); transform: scale(1.04); } to { filter: blur(0); transform: scale(1); } }

.placard { position: absolute; left: 0; right: 0; top: 1380px; text-align: center;
  animation: rise .6s ease-out 1.0s both; }
.placard-name { font-family: var(--dub-font-display); font-style: italic; font-weight: 700; font-size: 64px;
  color: var(--dub-soft); white-space: nowrap; letter-spacing: -.01em;
  animation: track .6s ease-out 1.0s both; }
@keyframes track { from { letter-spacing: -.15em; opacity: 0; } to { letter-spacing: .01em; opacity: 1; } }
.placard-line { margin-top: 18px; display: flex; align-items: baseline; justify-content: center; gap: 16px;
  font-family: var(--dub-font-body); }
.price { font-size: 44px; font-weight: 700; color: var(--dub-gold); font-family: var(--dub-font-display); }
.dot { color: var(--dub-soft); opacity: .5; }
.size { font-size: 30px; font-weight: 600; color: var(--dub-soft); letter-spacing: 2px; }
.placard-sku { margin-top: 12px; font-family: var(--dub-font-body); font-size: 22px; letter-spacing: 5px;
  color: var(--dub-soft); opacity: .6; }
.placard-cta { margin-top: 26px; font-family: var(--dub-font-body); font-weight: 700; font-size: 28px;
  letter-spacing: 2px; color: var(--dub-soft); }
@keyframes rise { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 6: Generate preview + eyeball**

Run: `yarn regen-previews framed-gallery-1color`
Expected: matted print on a dark wall, gold inner keyline, museum placard below with italic name + gold price.

- [ ] **Step 7: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/story-templates/framed-gallery-1color src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add framed-gallery-1color template (1-color)"
```

---

## Task 5: 2-color rotation + `diagonal-2color-wipe`

This task adds the `TWO_COLOR_FRONT_ROTATION` pool (the one structural picker change) and the first 2-color template.

**Files:**
- Create: `src/story-templates/diagonal-2color-wipe/{meta.json,index.html,styles.css}`
- Modify: `src/modules/stories-render/picker.ts` (new pool + 2-color-no-back branch + override arm)
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("2-color-no-back rotates the front pool incl diagonal-2color-wipe", () => {
  const s = snapshot({
    name: "Wrap Blouse",
    price_mur: 1190,
    variants_in_stock: [
      color("rose", ["front"], { sku: "IS3000-M-R", sizes: ["S", "M"], color: "Rose" }),
      color("noir", ["front"], { sku: "IS3000-M-N", sizes: ["M", "L"], color: "Noir" }),
    ],
    variant_in_stock_count: 2,
  })
  // Saturate product-2colors-front + swipe-through so least-used lands on diagonal.
  const picked = new Map<string, number>([
    ["product-2colors-front", 2],
    ["swipe-through-2color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("diagonal-2color-wipe")
  expect(result!.slot_inputs.front_a).toBe("https://r2/rose.jpg")
  expect(result!.slot_inputs.front_b).toBe("https://r2/noir.jpg")
  expect(result!.text_overrides.size_a).toContain("S")
  expect(result!.text_overrides.price).toBe("Rs.1190")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit picker.unit.spec.ts -t "rotates the front pool"`
Expected: FAIL — currently the 2-color-no-back branch always returns `product-2colors-front`.

- [ ] **Step 3: Add the rotation pool**

In `picker.ts`, near the other rotation consts, add:

```ts
// 2-color, FRONT-ONLY (no usable back). Was a single hardcoded
// product-2colors-front return; 2026-05-30 made a 3-way rotation so
// consecutive 2-color-no-back products read distinct. Same { front_a,
// front_b } slot contract across all three.
const TWO_COLOR_FRONT_ROTATION = [
  "product-2colors-front",
  "diagonal-2color-wipe",
  "swipe-through-2color",
] as const
```

- [ ] **Step 4: Rewrite the 2-color-no-back branch**

In `picker.ts`, replace the block that currently returns `product-2colors-front`:

```ts
    if (a && b && TWO_COLOR_FRONT_ROTATION.some((sg) => !isSaturated(pickedSoFar, sg))) {
      const slug = pickedSoFar
        ? leastUsed(TWO_COLOR_FRONT_ROTATION, pickedSoFar)
        : TWO_COLOR_FRONT_ROTATION[slotIndex % TWO_COLOR_FRONT_ROTATION.length]
      return {
        template_slug: slug,
        slot_inputs: { front_a: a, front_b: b },
        text_overrides: buildTextOverrides(slug, snapshot),
      }
    }
```

(Preserves the original default: when `pickedSoFar` is absent and `slotIndex` is 0, `TWO_COLOR_FRONT_ROTATION[0]` = `product-2colors-front`, so existing slotIndex-based tests stay green.)

- [ ] **Step 5: Add the override arm**

In `picker.ts`, add the two new slugs to the existing `product-2colors-front` arm (which already produces `price`, `size_a`, `size_b`, `sku`):

```ts
    case "product-2colors":
    case "product-2colors-blush":
    case "product-2colors-cream":
    case "product-2colors-sage":
    case "product-2colors-coral":
    case "product-2colors-front":
    case "diagonal-2color-wipe":
    case "swipe-through-2color": {
      const colors = snapshot.variants_in_stock
      out.price = price
      out.size_a = sizesForVariant(colors[0], 22)
      out.size_b = sizesForVariant(colors[1], 22)
      if (sku) out.sku = sku
      return out
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn test:unit picker.unit.spec.ts -t "rotates the front pool"`
Expected: PASS.

- [ ] **Step 7: Create `meta.json`**

`src/story-templates/diagonal-2color-wipe/meta.json`:

```json
{
  "slug": "diagonal-2color-wipe",
  "name": "2 Colors · Diagonal Wipe",
  "category": "single-product-multi-image",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "front_a", "hint": "front", "label": "Front · color A", "required": true },
    { "id": "front_b", "hint": "front", "label": "Front · color B", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "2 COLOURS", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size_a", "default": "S · M · L", "max_chars": 22 },
    { "id": "size_b", "default": "S · M · L", "max_chars": 22 },
    { "id": "footer", "default": "DM to ORDER", "max_chars": 20 }
  ]
}
```

- [ ] **Step 8: Create `index.html`**

`src/story-templates/diagonal-2color-wipe/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="tri tri-a"><img data-hf-image="front_a" alt="" /><span class="tag tag-a">01</span></div>
        <div class="tri tri-b"><img data-hf-image="front_b" alt="" /><span class="tag tag-b">02</span></div>
        <div class="seam" aria-hidden="true"></div>
        <div class="gloss" aria-hidden="true"></div>
        <div class="lozenge">
          <span class="l-name" data-hf-text="headline">2 COLOURS</span>
          <span class="l-price" data-hf-text="price">Rs.0</span>
        </div>
        <div class="info">
          <div class="sizes"><span data-hf-text="size_a">S · M · L</span><span class="bar">|</span><span data-hf-text="size_b">S · M · L</span></div>
          <div class="footer" data-hf-text="footer">DM to ORDER</div>
          <span class="sku" data-hf-text="sku">IS0000</span>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 9: Create `styles.css`**

`src/story-templates/diagonal-2color-wipe/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-ink); }
.scene { position: absolute; inset: 0; overflow: hidden; }

.tri { position: absolute; inset: 0; }
.tri img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* upper-left triangle */
.tri-a { clip-path: polygon(0 0, 100% 0, 0 100%); animation: slideInL .8s cubic-bezier(.4,0,.2,1) both; }
/* lower-right triangle */
.tri-b { clip-path: polygon(100% 0, 100% 100%, 0 100%); animation: slideInR .8s cubic-bezier(.4,0,.2,1) both; }
@keyframes slideInL { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes slideInR { from { transform: translateX(100%); } to { transform: translateX(0); } }

.tag { position: absolute; font-family: var(--dub-font-body); font-weight: 800; font-size: 28px;
  letter-spacing: 4px; color: var(--dub-soft); }
.tag-a { top: 40px; left: 40px; }
.tag-b { bottom: 230px; right: 40px; }

/* gold seam along the diagonal: a rotated bar revealed by scaleX */
.seam { position: absolute; top: 50%; left: -20%; width: 140%; height: 4px; background: var(--dub-gold);
  transform-origin: center; transform: rotate(-50.5deg) scaleX(0);
  animation: drawSeam .5s ease-out .9s both; box-shadow: 0 0 18px rgba(201,169,110,.7); }
@keyframes drawSeam { to { transform: rotate(-50.5deg) scaleX(1); } }

/* premium gloss: white→transparent band, screen blend, one pass */
.gloss { position: absolute; top: -20%; left: -60%; width: 50%; height: 140%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent);
  transform: rotate(18deg); mix-blend-mode: screen; opacity: 0;
  animation: sweep 1.1s ease-in-out 3.0s both; }
@keyframes sweep { 0% { transform: translateX(0) rotate(18deg); opacity: 0; }
  20% { opacity: 1; } 100% { transform: translateX(380%) rotate(18deg); opacity: 0; } }

.lozenge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  background: var(--dub-soft); border-radius: 22px; padding: 22px 40px; text-align: center;
  box-shadow: 0 18px 40px rgba(43,43,43,.3); animation: pop .5s cubic-bezier(.34,1.4,.64,1) 1.4s both; }
@keyframes pop { from { opacity: 0; transform: translate(-50%, -50%) scale(.8); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.l-name { display: block; font-family: var(--dub-font-body); font-weight: 800; font-size: 26px; letter-spacing: 4px; color: var(--dub-ink); }
.l-price { display: block; font-family: var(--dub-font-display); font-weight: 700; font-size: 64px; color: var(--dub-gold); line-height: 1.1; }

.info { position: absolute; left: 0; right: 0; bottom: 56px; text-align: center;
  animation: rise .5s ease-out 1.8s both; }
.sizes { font-family: var(--dub-font-body); font-weight: 700; font-size: 28px; letter-spacing: 2px; color: var(--dub-soft); display: flex; gap: 18px; justify-content: center; }
.sizes .bar { opacity: .5; }
.footer { margin-top: 12px; font-family: var(--dub-font-body); font-weight: 800; font-size: 30px; letter-spacing: 4px; color: var(--dub-soft); }
.sku { display: inline-block; margin-top: 10px; font-family: var(--dub-font-body); font-size: 20px; letter-spacing: 4px; color: var(--dub-soft); opacity: .7; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 10: Generate preview + eyeball**

Run: `yarn regen-previews diagonal-2color-wipe`
Expected: diagonal split of two photos, gold seam, centered lozenge with name+price, sizes/footer at bottom.

- [ ] **Step 11: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS — including the pre-existing 2-color tests (slotIndex default still resolves to `product-2colors-front`).

- [ ] **Step 12: Commit**

```bash
git add src/story-templates/diagonal-2color-wipe src/modules/stories-render/picker.ts src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add 2-color front rotation + diagonal-2color-wipe"
```

---

## Task 6: `swipe-through-2color` (2-color)

Slug already in `TWO_COLOR_FRONT_ROTATION` + override arm (Task 5). Folder + test.

**Files:**
- Create: `src/story-templates/swipe-through-2color/{meta.json,index.html,styles.css}`
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("swipe-through-2color is reachable with both fronts + per-color sizes", () => {
  const s = snapshot({
    name: "Pleated Skirt",
    price_mur: 1090,
    variants_in_stock: [
      color("ivory", ["front"], { sku: "IS3100-M-I", sizes: ["S", "M"], color: "Ivory" }),
      color("olive", ["front"], { sku: "IS3100-M-O", sizes: ["L"], color: "Olive" }),
    ],
    variant_in_stock_count: 2,
  })
  const picked = new Map<string, number>([
    ["product-2colors-front", 2],
    ["diagonal-2color-wipe", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("swipe-through-2color")
  expect(result!.slot_inputs.front_a).toBe("https://r2/ivory.jpg")
  expect(result!.slot_inputs.front_b).toBe("https://r2/olive.jpg")
  expect(result!.text_overrides.size_b).toContain("L")
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `yarn test:unit picker.unit.spec.ts -t "swipe-through-2color is reachable"`
Expected: PASS on picker side (pool + arm from Task 5). Build the folder so it renders.

- [ ] **Step 3: Create `meta.json`**

`src/story-templates/swipe-through-2color/meta.json`:

```json
{
  "slug": "swipe-through-2color",
  "name": "2 Colors · Swipe Through",
  "category": "single-product-multi-image",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "front_a", "hint": "front", "label": "Front · color A", "required": true },
    { "id": "front_b", "hint": "front", "label": "Front · color B", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "SWIPE FOR COLOUR 2", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size_a", "default": "S · M · L", "max_chars": 22 },
    { "id": "size_b", "default": "S · M · L", "max_chars": 22 },
    { "id": "footer", "default": "DM to ORDER", "max_chars": 20 }
  ]
}
```

- [ ] **Step 4: Create `index.html`**

`src/story-templates/swipe-through-2color/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="stage">
          <div class="layer layer-a"><img data-hf-image="front_a" alt="" /></div>
          <div class="layer layer-b"><img data-hf-image="front_b" alt="" /></div>
        </div>
        <div class="bars" aria-hidden="true"><span class="bar bar-a"></span><span class="bar bar-b"></span></div>
        <div class="scrim">
          <div class="kicker" data-hf-text="headline">SWIPE FOR COLOUR 2</div>
          <div class="row"><span class="price" data-hf-text="price">Rs.0</span><span class="sku" data-hf-text="sku">IS0000</span></div>
          <div class="sizes"><span data-hf-text="size_a">S · M · L</span><span class="sep">/</span><span data-hf-text="size_b">S · M · L</span></div>
          <div class="footer" data-hf-text="footer">DM to ORDER</div>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: Create `styles.css`**

`src/story-templates/swipe-through-2color/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-ink); }
.scene { position: absolute; inset: 0; overflow: hidden; }

.stage { position: absolute; inset: 0; }
.layer { position: absolute; inset: 0; }
.layer img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* A is the base (opacity 1, frame 0). It parallaxes left when B comes over. */
.layer-a { z-index: 1; animation: parallaxA 1s cubic-bezier(.34,1.4,.64,1) 1.7s both; }
@keyframes parallaxA { from { transform: translateX(0); } to { transform: translateX(-7%); } }
/* B slides over from the right with a leading-edge shadow. */
.layer-b { z-index: 2; transform: translateX(100%); box-shadow: -24px 0 40px rgba(43,43,43,.28);
  animation: swipeB .75s cubic-bezier(.34,1.4,.64,1) 1.7s both; }
@keyframes swipeB { 0% { transform: translateX(100%); } 60% { transform: translateX(-2%); } 100% { transform: translateX(0); } }

.bars { position: absolute; top: 40px; right: 40px; display: flex; gap: 10px; z-index: 4; }
.bar { height: 8px; border-radius: 99px; background: var(--dub-soft); }
.bar-a { width: 70px; animation: barA .5s ease 2.4s both; }
.bar-b { width: 24px; opacity: .5; animation: barB .5s ease 2.4s both; }
@keyframes barA { to { width: 24px; opacity: .5; } }
@keyframes barB { to { width: 70px; opacity: 1; } }

.scrim { position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 50px 64px; z-index: 3;
  background: linear-gradient(to top, rgba(43,43,43,.92), rgba(43,43,43,.55) 60%, transparent); }
.kicker { font-family: var(--dub-font-body); font-weight: 700; font-size: 24px; letter-spacing: 4px; color: var(--dub-soft); opacity: .85; }
.row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 10px; }
.price { font-family: var(--dub-font-display); font-weight: 700; font-size: 92px; color: var(--dub-soft); line-height: 1; }
.sku { font-family: var(--dub-font-body); font-size: 22px; letter-spacing: 3px; color: var(--dub-soft); opacity: .75; }
.sizes { margin-top: 8px; font-family: var(--dub-font-body); font-weight: 700; font-size: 30px; letter-spacing: 2px; color: var(--dub-soft); display: flex; gap: 14px; }
.sizes .sep { opacity: .5; }
.footer { margin-top: 14px; font-family: var(--dub-font-body); font-weight: 800; font-size: 30px; letter-spacing: 4px; color: var(--dub-soft); }
```

- [ ] **Step 6: Generate preview + eyeball**

Run: `yarn regen-previews swipe-through-2color`
Expected: single full-bleed photo (color A at frame 0 — preview is one frame, so it shows A) with a fixed dark scrim holding text + two color bars top-right.

- [ ] **Step 7: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/story-templates/swipe-through-2color src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add swipe-through-2color template (2-color)"
```

---

## Task 7: Back-bucket rotation + `cardflip-front-back` (front+back, HARD-GATED)

Adds the three back templates to `ONE_COLOR_FRONT_BACK_ROTATION` (gated implicitly — the branch is unreachable without a `pickBack` result) and builds the card-flip.

**Files:**
- Create: `src/story-templates/cardflip-front-back/{meta.json,index.html,styles.css}`
- Modify: `src/modules/stories-render/picker.ts` (rotation pool + override arm)
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write two tests — reachable WITH back, NOT firing WITHOUT back**

```ts
it("cardflip-front-back fires only when a back shot exists", () => {
  const s = snapshot({
    name: "Tie Back Dress",
    price_mur: 1490,
    variants_in_stock: [color("blush", ["front", "back"], { sku: "IS4000-M-B", sizes: ["S", "M", "L"] })],
    variant_in_stock_count: 1,
  })
  // Saturate every OTHER back-rotation slug so least-used lands on cardflip.
  const picked = new Map<string, number>([
    ["product-1color", 2], ["product-1color-blush", 2], ["product-1color-cream", 2],
    ["product-1color-sage", 2], ["product-1color-coral", 2],
    ["product-1color-featured", 2], ["product-1color-featured-blush", 2],
    ["product-1color-featured-cream", 2], ["product-1color-featured-sage", 2],
    ["product-1color-featured-coral", 2], ["new-drop-arch", 2], ["new-drop-arch-blush", 2],
    ["new-drop-arch-cream", 2], ["new-drop-arch-sage", 2], ["new-drop-arch-coral", 2],
    ["lookbook-spread-back", 2], ["filmstrip-multiframe", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("cardflip-front-back")
  expect(result!.slot_inputs.front).toBe("https://r2/blush.jpg")
  expect(result!.slot_inputs.back).toBe("https://r2/blush-b.jpg")
  expect(result!.text_overrides.price).toBe("Rs.1490")
})

it("back templates never fire on a front-only product", () => {
  const s = snapshot({
    name: "Front Only Tee",
    price_mur: 600,
    variants_in_stock: [color("white", ["front"], { sku: "IS4100-M-W", sizes: ["M"] })],
    variant_in_stock_count: 1,
  })
  const result = pickTemplate(s, 0)
  expect(["cardflip-front-back", "lookbook-spread-back", "filmstrip-multiframe"])
    .not.toContain(result!.template_slug)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test:unit picker.unit.spec.ts -t "cardflip-front-back fires only"`
Expected: FAIL — slug not in rotation yet.

- [ ] **Step 3: Add the three slugs to the back rotation**

In `picker.ts`, extend `ONE_COLOR_FRONT_BACK_ROTATION` (append the three new slugs):

```ts
const ONE_COLOR_FRONT_BACK_ROTATION = [
  "product-1color",
  "product-1color-blush",
  "product-1color-cream",
  "product-1color-sage",
  "product-1color-coral",
  "product-1color-featured",
  "product-1color-featured-blush",
  "product-1color-featured-cream",
  "product-1color-featured-sage",
  "product-1color-featured-coral",
  "new-drop-arch",
  "new-drop-arch-blush",
  "new-drop-arch-cream",
  "new-drop-arch-sage",
  "new-drop-arch-coral",
  "cardflip-front-back",
  "lookbook-spread-back",
  "filmstrip-multiframe",
] as const
```

- [ ] **Step 4: Add the override arm for the three back slugs**

In `picker.ts`, the existing 1-color arm (`product-1color` … `many-photos`) returns `{ price, size, sku }`. The back templates also need `headline`=name. Add a dedicated arm:

```ts
    case "cardflip-front-back":
    case "lookbook-spread-back":
    case "filmstrip-multiframe": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 24)
      if (sku) out.sku = sku
      return out
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test:unit picker.unit.spec.ts -t "cardflip-front-back fires only"`
Run: `yarn test:unit picker.unit.spec.ts -t "back templates never fire"`
Expected: both PASS.

- [ ] **Step 6: Create `meta.json`**

`src/story-templates/cardflip-front-back/meta.json`:

```json
{
  "slug": "cardflip-front-back",
  "name": "Card Flip · Front to Back",
  "category": "single-product-multi-image",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "front", "hint": "front", "label": "Front photo", "required": true },
    { "id": "back", "hint": "back", "label": "Back photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "FRONT & BACK", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 7: Create `index.html`**

`src/story-templates/cardflip-front-back/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <span class="kicker" data-hf-text="headline">FRONT &amp; BACK</span>
        <div class="stage">
          <div class="flipper">
            <div class="face face-front"><img data-hf-image="front" alt="" /></div>
            <div class="face face-back"><img data-hf-image="back" alt="" /></div>
            <div class="spine" aria-hidden="true"></div>
          </div>
        </div>
        <div class="band">
          <span class="price" data-hf-text="price">Rs.0</span>
          <div class="band-row"><span class="size" data-hf-text="size">Size: S · M · L</span><span class="sku" data-hf-text="sku">IS0000</span></div>
          <a class="shop-chip" aria-label="Shop now at dollupboutique.com">
            <span class="shop-chip-label">Shop now</span>
            <span class="shop-chip-arrow" aria-hidden="true">&#8594;</span>
            <span class="shop-chip-url">dollupboutique.com</span>
          </a>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 8: Create `styles.css`**

`src/story-templates/cardflip-front-back/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-blush); }
.scene { position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 40%, var(--dub-soft), var(--dub-blush) 75%); }

.kicker { position: absolute; top: 70px; left: 0; right: 0; text-align: center;
  font-family: var(--dub-font-body); font-weight: 700; font-size: 28px; letter-spacing: 6px; color: var(--dub-ink);
  animation: rise .5s ease-out .3s both; }

.stage { position: absolute; top: 180px; left: 50%; transform: translateX(-50%);
  width: 720px; height: 1180px; perspective: 1600px; }
.flipper { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
  animation: flip 1.4s ease-in-out 2.2s both; }
@keyframes flip {
  0%, 30% { transform: rotateY(0); }
  50% { transform: rotateY(90deg) scale(.96); }
  70%, 100% { transform: rotateY(180deg); }
}
.face { position: absolute; inset: 0; border-radius: 26px; overflow: hidden;
  backface-visibility: hidden; -webkit-backface-visibility: hidden;
  box-shadow: 0 30px 60px rgba(43,43,43,.3); background: var(--dub-soft); }
.face img { width: 100%; height: 100%; object-fit: cover; display: block; }
.face-back { transform: rotateY(180deg); }
/* gold spine so the edge-on frame reads intentional */
.spine { position: absolute; top: 0; bottom: 0; left: 50%; width: 8px; transform: translateX(-50%) translateZ(-4px);
  background: linear-gradient(var(--dub-gold), #b8975c); border-radius: 4px; }

.band { position: absolute; left: 0; right: 0; bottom: 70px; text-align: center;
  animation: rise .6s ease-out .6s both; }
.price { font-family: var(--dub-font-display); font-weight: 700; font-size: 96px; color: var(--dub-ink); line-height: 1; }
.band-row { display: flex; gap: 20px; align-items: baseline; justify-content: center; margin-top: 8px; }
.size { font-family: var(--dub-font-body); font-weight: 700; font-size: 30px; letter-spacing: 2px; color: var(--dub-ink); }
.sku { font-family: var(--dub-font-body); font-size: 22px; letter-spacing: 3px; color: var(--dub-ink); opacity: .65; }
.shop-chip { display: inline-flex; align-items: baseline; gap: 14px; margin-top: 18px;
  font-family: var(--dub-font-display); font-style: italic; font-weight: 600; font-size: 34px; color: var(--dub-ink); }
.shop-chip-arrow { font-family: var(--dub-font-body); font-size: 38px; animation: arrowSlide 1.8s ease-in-out 3.6s infinite; }
.shop-chip-url { font-family: var(--dub-font-body); font-style: normal; font-weight: 500; font-size: 24px; letter-spacing: 2px; opacity: .78; }
@keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes arrowSlide { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(12px); } }
```

- [ ] **Step 9: Generate preview + render MP4 (motion-heavy — verify the flip)**

Run: `yarn regen-previews cardflip-front-back`
Expected preview: the front face card centered on a blush field with the text band (preview = frame 0, shows front).

Then render a full MP4 to confirm the flip reads (the preview can't show motion). Use the admin Re-render button on a slot assigned this template, OR run a local render via the render daemon path. Confirm: card holds front, turns, holds back; the 90° frame shows the gold spine, not a blank flicker.

- [ ] **Step 10: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/story-templates/cardflip-front-back src/modules/stories-render/picker.ts src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add back rotation + cardflip-front-back (hard-gated)"
```

---

## Task 8: `lookbook-spread-back` (front+back, HARD-GATED)

Slug already in `ONE_COLOR_FRONT_BACK_ROTATION` + override arm (Task 7). Folder + test.

**Files:**
- Create: `src/story-templates/lookbook-spread-back/{meta.json,index.html,styles.css}`
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("lookbook-spread-back fills front + back slots", () => {
  const s = snapshot({
    name: "Halter Maxi",
    price_mur: 1690,
    variants_in_stock: [color("teal", ["front", "back"], { sku: "IS4200-M-T", sizes: ["S", "M"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["product-1color", 2], ["product-1color-blush", 2], ["product-1color-cream", 2],
    ["product-1color-sage", 2], ["product-1color-coral", 2], ["product-1color-featured", 2],
    ["product-1color-featured-blush", 2], ["product-1color-featured-cream", 2],
    ["product-1color-featured-sage", 2], ["product-1color-featured-coral", 2],
    ["new-drop-arch", 2], ["new-drop-arch-blush", 2], ["new-drop-arch-cream", 2],
    ["new-drop-arch-sage", 2], ["new-drop-arch-coral", 2],
    ["cardflip-front-back", 2], ["filmstrip-multiframe", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("lookbook-spread-back")
  expect(result!.slot_inputs.front).toBe("https://r2/teal.jpg")
  expect(result!.slot_inputs.back).toBe("https://r2/teal-b.jpg")
})
```

- [ ] **Step 2: Run test (passes on picker side)**

Run: `yarn test:unit picker.unit.spec.ts -t "lookbook-spread-back fills"`
Expected: PASS. Build the folder.

- [ ] **Step 3: Create `meta.json`**

`src/story-templates/lookbook-spread-back/meta.json`:

```json
{
  "slug": "lookbook-spread-back",
  "name": "Lookbook Spread · Front & Back",
  "category": "single-product-multi-image",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "front", "hint": "front", "label": "Front photo", "required": true },
    { "id": "back", "hint": "back", "label": "Back photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "THE LOOK", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 4: Create `index.html`**

`src/story-templates/lookbook-spread-back/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="half half-top"><img data-hf-image="front" alt="" /><span class="kick kick-top">FRONT</span><span class="name" data-hf-text="headline">THE LOOK</span></div>
        <div class="half half-bottom"><img data-hf-image="back" alt="" /><span class="kick kick-bottom">BACK</span></div>
        <div class="hairline" aria-hidden="true"></div>
        <div class="badge"><span data-hf-text="price">Rs.0</span></div>
        <div class="footer">
          <span class="size" data-hf-text="size">Size: S · M · L</span>
          <span class="sku" data-hf-text="sku">IS0000</span>
          <span class="cta">DM TO ORDER &#8594;</span>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: Create `styles.css`**

`src/story-templates/lookbook-spread-back/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-cream); }
.scene { position: absolute; inset: 0; overflow: hidden; }

.half { position: absolute; left: 0; right: 0; height: 50%; overflow: hidden; }
.half img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* clean ease-out so the halves kiss at center (no overshoot crossing the seam) */
.half-top { top: 0; animation: dropTop .9s cubic-bezier(.25,.1,.25,1) both; }
.half-bottom { bottom: 0; animation: riseBottom .9s cubic-bezier(.25,.1,.25,1) both; }
@keyframes dropTop { from { transform: translateY(-100%); } to { transform: translateY(0); } }
@keyframes riseBottom { from { transform: translateY(100%); } to { transform: translateY(0); } }

.kick { position: absolute; font-family: var(--dub-font-body); font-weight: 800; font-size: 24px;
  letter-spacing: 5px; color: var(--dub-soft); background: rgba(43,43,43,.5); padding: 6px 16px; border-radius: 99px; }
.kick-top { top: 30px; left: 30px; }
.kick-bottom { bottom: 30px; right: 30px; }
.name { position: absolute; top: 40px; right: 36px; max-width: 60%; text-align: right;
  font-family: var(--dub-font-display); font-weight: 800; font-size: 56px; color: var(--dub-soft);
  text-shadow: 0 4px 16px rgba(43,43,43,.4); line-height: 1; }

/* gold hairline rendered ON TOP at full width from frame 0 to mask the seam; glint draws later */
.hairline { position: absolute; top: 50%; left: 0; right: 0; height: 4px; transform: translateY(-50%);
  background: var(--dub-gold); z-index: 3; box-shadow: 0 0 16px rgba(201,169,110,.6); }

.badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0); z-index: 4;
  width: 220px; height: 220px; border-radius: 50%; background: var(--dub-soft);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 16px 40px rgba(43,43,43,.3); animation: pop .5s cubic-bezier(.34,1.4,.64,1) 1.0s both; }
@keyframes pop { to { transform: translate(-50%, -50%) scale(1); } }
.badge span { font-family: var(--dub-font-display); font-weight: 700; font-size: 52px; color: var(--dub-gold); }

.footer { position: absolute; left: 0; right: 0; bottom: 40px; z-index: 4; text-align: center;
  display: flex; flex-direction: column; gap: 8px; animation: rise .5s ease-out 1.6s both; }
.size { font-family: var(--dub-font-body); font-weight: 700; font-size: 28px; letter-spacing: 2px; color: var(--dub-soft); text-shadow: 0 2px 8px rgba(43,43,43,.5); }
.sku { font-family: var(--dub-font-body); font-size: 20px; letter-spacing: 4px; color: var(--dub-soft); opacity: .8; }
.cta { font-family: var(--dub-font-display); font-style: italic; font-weight: 600; font-size: 32px; color: var(--dub-soft); text-shadow: 0 2px 8px rgba(43,43,43,.5); }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 6: Generate preview + eyeball**

Run: `yarn regen-previews lookbook-spread-back`
Expected: top half (front) + bottom half (back), gold hairline across the middle, circular price badge on the seam, footer at the bottom.

- [ ] **Step 7: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/story-templates/lookbook-spread-back src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add lookbook-spread-back template (hard-gated)"
```

---

## Task 9: `filmstrip-multiframe` (front+back, HARD-GATED)

Slug already in pool + override arm (Task 7). Folder + test.

**Files:**
- Create: `src/story-templates/filmstrip-multiframe/{meta.json,index.html,styles.css}`
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("filmstrip-multiframe fills front + back as reel frames", () => {
  const s = snapshot({
    name: "Belted Coat",
    price_mur: 2490,
    variants_in_stock: [color("camel", ["front", "back"], { sku: "IS4300-M-C", sizes: ["M", "L"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["product-1color", 2], ["product-1color-blush", 2], ["product-1color-cream", 2],
    ["product-1color-sage", 2], ["product-1color-coral", 2], ["product-1color-featured", 2],
    ["product-1color-featured-blush", 2], ["product-1color-featured-cream", 2],
    ["product-1color-featured-sage", 2], ["product-1color-featured-coral", 2],
    ["new-drop-arch", 2], ["new-drop-arch-blush", 2], ["new-drop-arch-cream", 2],
    ["new-drop-arch-sage", 2], ["new-drop-arch-coral", 2],
    ["cardflip-front-back", 2], ["lookbook-spread-back", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("filmstrip-multiframe")
  expect(result!.slot_inputs.front).toBe("https://r2/camel.jpg")
  expect(result!.slot_inputs.back).toBe("https://r2/camel-b.jpg")
})
```

- [ ] **Step 2: Run test (passes on picker side)**

Run: `yarn test:unit picker.unit.spec.ts -t "filmstrip-multiframe fills"`
Expected: PASS. Build the folder.

- [ ] **Step 3: Create `meta.json`**

`src/story-templates/filmstrip-multiframe/meta.json`:

```json
{
  "slug": "filmstrip-multiframe",
  "name": "Film Strip · Front & Back",
  "category": "single-product-multi-image",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "front", "hint": "front", "label": "Front photo", "required": true },
    { "id": "back", "hint": "back", "label": "Back photo", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "TWO ANGLES", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 4: Create `index.html`**

`src/story-templates/filmstrip-multiframe/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="strip">
          <div class="sprockets left" aria-hidden="true"></div>
          <div class="frames">
            <div class="frame"><img data-hf-image="front" alt="" /><span class="exposure" data-hf-text="headline">TWO ANGLES</span></div>
            <div class="frame"><img data-hf-image="back" alt="" /><span class="exposure" data-hf-text="sku">IS0000</span></div>
          </div>
          <div class="sprockets right" aria-hidden="true"></div>
          <span class="side-label">DUB &#183; 35MM</span>
        </div>
        <div class="base">
          <span class="price" data-hf-text="price">Rs.0</span>
          <span class="size" data-hf-text="size">Size: S · M · L</span>
          <span class="cta">DM TO ORDER &#8594; dollupboutique.com</span>
        </div>
      </div>
    </div>
  </body>
</html>
```

- [ ] **Step 5: Create `styles.css`**

`src/story-templates/filmstrip-multiframe/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-cream); }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; }

/* whole strip advances up into place; photos opacity 1, only translate animates */
.strip { position: relative; width: 66%; margin-top: 40px; height: 1440px; background: #141414;
  display: flex; align-items: stretch; padding: 0 46px; border-radius: 6px;
  animation: advance 1s ease-out both, drift 3s ease-in-out 1.2s infinite alternate; }
@keyframes advance { from { transform: translateY(40%); } to { transform: translateY(0); } }
@keyframes drift { from { transform: translateY(0); } to { transform: translateY(-4px); } }

.sprockets { width: 30px; background-image: repeating-radial-gradient(circle at 50% 22px, var(--dub-cream) 0 9px, transparent 10px 44px); }
.frames { flex: 1; display: flex; flex-direction: column; gap: 16px; padding: 22px 0; }
.frame { position: relative; flex: 1; overflow: hidden; border: 3px solid #000; background: #000; }
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.exposure { position: absolute; bottom: 8px; left: 10px; font-family: var(--dub-font-body); font-weight: 600;
  font-size: 18px; letter-spacing: 3px; color: #f3d27a; opacity: 0; animation: fade .5s ease 1.0s both; }
@keyframes fade { to { opacity: .9; } }
.side-label { position: absolute; top: 50%; right: -2px; transform: translateY(-50%) rotate(180deg);
  writing-mode: vertical-rl; font-family: var(--dub-font-body); font-weight: 700; font-size: 18px;
  letter-spacing: 6px; color: var(--dub-cream); opacity: .7; }

.base { margin-top: auto; padding-bottom: 50px; text-align: center; display: flex; flex-direction: column; gap: 8px;
  animation: rise .5s ease-out 1.4s both; }
.price { font-family: var(--dub-font-display); font-weight: 700; font-size: 84px; color: var(--dub-ink); line-height: 1; }
.size { font-family: var(--dub-font-body); font-weight: 700; font-size: 28px; letter-spacing: 2px; color: var(--dub-ink); }
.cta { font-family: var(--dub-font-body); font-weight: 700; font-size: 26px; letter-spacing: 2px; color: var(--dub-ink); }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 6: Generate preview + eyeball**

Run: `yarn regen-previews filmstrip-multiframe`
Expected: vertical black film strip with sprocket holes down both sides, two frames (front top, back bottom), price/size/CTA on the cream base below.

- [ ] **Step 7: Run picker suite**

Run: `yarn test:unit picker.unit.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/story-templates/filmstrip-multiframe src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add filmstrip-multiframe template (hard-gated)"
```

---

## Task 10: `bigprice-cutout-hero` (cutout, HARD-GATED)

Adds the cutout template in BOTH cutout sites: the daily-cutout-guarantee rotation at the top of `pickTemplate` and the single-image cutout pool extension. Gated implicitly (cutout branches only run when `pickCutout` returns a PNG).

**Files:**
- Create: `src/story-templates/bigprice-cutout-hero/{meta.json,index.html,styles.css}`
- Modify: `src/modules/stories-render/picker.ts` (cutout guarantee rotation + pool extension + override arm)
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write two tests — fires on cutout, never without**

```ts
it("bigprice-cutout-hero can fire for a single-color cutout product", () => {
  const s = snapshot({
    name: "Mesh Bodysuit",
    price_mur: 790,
    variants_in_stock: [color("black", ["front", "cutout"], { sku: "IS5000-M-B", sizes: ["S", "M"] })],
    variant_in_stock_count: 1,
  })
  // Saturate cutout-spotlight v1/v2 so the guarantee picks the new one;
  // (guarantee only fires when cutoutCount === 0, so instead drive it via the
  // single-image pool by also marking the product NOT the first cutout of day)
  const picked = new Map<string, number>([
    ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
    ["editorial-cover-hero", 2], ["split-thirds-editorial", 2],
    ["receipt-tag-1color", 2], ["framed-gallery-1color", 2],
    ["cutout-spotlight", 2], ["cutout-spotlight-v2", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).toBe("bigprice-cutout-hero")
  expect(result!.slot_inputs.product_cutout).toBe("https://r2/black-cutout.png")
  expect(result!.text_overrides.price).toBe("Rs.790")
})

it("bigprice-cutout-hero never fires without a cutout PNG", () => {
  const s = snapshot({
    name: "Plain Front",
    price_mur: 500,
    variants_in_stock: [color("white", ["front"], { sku: "IS5100-M-W", sizes: ["M"] })],
    variant_in_stock_count: 1,
  })
  const picked = new Map<string, number>([
    ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
    ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
    ["editorial-cover-hero", 2], ["split-thirds-editorial", 2],
    ["receipt-tag-1color", 2], ["framed-gallery-1color", 2],
  ])
  const result = pickTemplate(s, 0, picked)
  expect(result!.template_slug).not.toBe("bigprice-cutout-hero")
})
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `yarn test:unit picker.unit.spec.ts -t "bigprice-cutout-hero can fire"`
Expected: FAIL — slug not in any cutout site yet.

- [ ] **Step 3: Add the slug to the cutout-guarantee rotation**

In `picker.ts`, the daily-cutout guarantee at the top of `pickTemplate` currently chooses between `cutout-spotlight` and `cutout-spotlight-v2`. Extend it to a 3-way least-used choice. Replace the guarantee's slug-selection logic:

```ts
  const cutoutUrlEarly = pickCutout(colors)
  if (pickedSoFar && cutoutUrlEarly && colors.length === 1) {
    const CUTOUT_ROTATION = ["cutout-spotlight", "cutout-spotlight-v2", "bigprice-cutout-hero"] as const
    const cutoutCount =
      countOf(pickedSoFar, "cutout-spotlight") +
      countOf(pickedSoFar, "cutout-spotlight-v2") +
      countOf(pickedSoFar, "bigprice-cutout-hero")
    if (cutoutCount === 0) {
      const cutoutSlug = leastUsed(CUTOUT_ROTATION, pickedSoFar)
      return {
        template_slug: cutoutSlug,
        slot_inputs: { product_cutout: cutoutUrlEarly },
        text_overrides: buildTextOverrides(cutoutSlug, snapshot),
      }
    }
  }
```

- [ ] **Step 4: Add the slug to the single-image cutout pool extension**

In `picker.ts`, the pool builder near the bottom currently does:

```ts
  const pool: readonly string[] = cutoutEligible
    ? [...SINGLE_IMAGE_ROTATION, "cutout-spotlight", "cutout-spotlight-v2"]
    : SINGLE_IMAGE_ROTATION
```

Change to include the new slug:

```ts
  const pool: readonly string[] = cutoutEligible
    ? [...SINGLE_IMAGE_ROTATION, "cutout-spotlight", "cutout-spotlight-v2", "bigprice-cutout-hero"]
    : SINGLE_IMAGE_ROTATION
```

And the guard just below that returns cutout templates from the pool must include the new slug:

```ts
  if ((slug === "cutout-spotlight" || slug === "cutout-spotlight-v2" || slug === "bigprice-cutout-hero") && cutoutUrl) {
    return {
      template_slug: slug,
      slot_inputs: { product_cutout: cutoutUrl },
      text_overrides: buildTextOverrides(slug, snapshot),
    }
  }
```

- [ ] **Step 5: Add the override arm**

In `picker.ts`, extend the existing cutout arm (which returns `price`, `size`, `sku`) and add `headline`=name for the big-price layout. Add a dedicated arm:

```ts
    case "cutout-spotlight":
    case "cutout-spotlight-v2": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "bigprice-cutout-hero": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 24)
      if (sku) out.sku = sku
      return out
    }
```

(If `cutout-spotlight`/`-v2` already share an arm, just split `bigprice-cutout-hero` into its own arm as shown.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn test:unit picker.unit.spec.ts -t "bigprice-cutout-hero"`
Expected: both PASS.

- [ ] **Step 7: Create `meta.json`**

`src/story-templates/bigprice-cutout-hero/meta.json`:

```json
{
  "slug": "bigprice-cutout-hero",
  "name": "Cutout · Big Price Hero",
  "category": "single-product",
  "duration_seconds": 6,
  "wave": 1,
  "slots": [
    { "id": "product_cutout", "hint": "cutout", "label": "Transparent cutout PNG", "required": true }
  ],
  "text_overrides": [
    { "id": "headline", "default": "THE PIECE", "max_chars": 24 },
    { "id": "price", "default": "Rs.0", "max_chars": 12 },
    { "id": "sku", "default": "IS0000", "max_chars": 10 },
    { "id": "size", "default": "Size: S · M · L", "max_chars": 28 }
  ]
}
```

- [ ] **Step 8: Create `index.html`**

`src/story-templates/bigprice-cutout-hero/index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="stylesheet" href="../_brand/tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="root" class="canvas" data-composition-id="main" data-start="0" data-duration="6" data-width="1080" data-height="1920">
      <div class="scene">
        <div class="glow" aria-hidden="true"></div>
        <div class="bigprice"><span class="rs">Rs</span><span class="amt" data-hf-text="price">0</span></div>
        <div class="cutout-wrap"><img class="cutout" data-hf-image="product_cutout" alt="" /></div>
        <div class="meta">
          <span class="name" data-hf-text="headline">THE PIECE</span>
          <span class="size" data-hf-text="size">Size: S · M · L</span>
          <span class="sku" data-hf-text="sku">IS0000</span>
        </div>
        <a class="cta">DM TO ORDER &#8594;</a>
      </div>
    </div>
  </body>
</html>
```

Note: the `price` override value is the full string `Rs.1290`; to render the giant number cleanly the template shows the whole override inside `.amt` and hides the static `Rs` prefix when redundant. Keep the static `Rs` superscript small; the override already contains `Rs.` so set `.rs { display:none }` if doubling looks wrong during preview (decide at eyeball step).

- [ ] **Step 9: Create `styles.css`**

`src/story-templates/bigprice-cutout-hero/styles.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: var(--story-w); height: var(--story-h); overflow: hidden; }
.canvas { width: var(--story-w); height: var(--story-h); background: var(--dub-cream); }
.scene { position: absolute; inset: 0; overflow: hidden; }

.glow { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
  width: 900px; height: 900px; border-radius: 50%;
  background: radial-gradient(circle, var(--dub-blush), transparent 70%);
  animation: breathe 6s ease-in-out infinite alternate; }
@keyframes breathe { from { opacity: .6; } to { opacity: .85; } }

/* giant gold price; solid-gold fallback so it's never invisible, sweep is a gloss on top */
.bigprice { position: absolute; top: 120px; left: 60px; display: flex; align-items: flex-start; z-index: 2;
  font-family: var(--dub-font-display); font-weight: 800; color: var(--dub-gold); line-height: .82;
  animation: trackIn .9s ease-out both; }
@keyframes trackIn { from { opacity: 0; letter-spacing: -.18em; } to { opacity: 1; letter-spacing: 0; } }
.rs { font-size: 70px; margin-top: 18px; margin-right: 6px; }
.amt { font-size: 240px;
  background: linear-gradient(100deg, var(--dub-gold) 0%, #e7cf95 45%, var(--dub-gold) 55%, #b8975c 100%);
  background-size: 250% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: goldSweep .9s ease-out .9s both; }
@keyframes goldSweep { to { background-position: 0 0; } }

.cutout-wrap { position: absolute; right: 20px; bottom: 220px; height: 1060px; z-index: 3;
  animation: cutoutRise .7s cubic-bezier(.16,1,.3,1) .5s both, float 4s ease-in-out 1.4s infinite alternate; }
@keyframes cutoutRise { from { opacity: 0; transform: translateY(40px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes float { from { transform: translateY(0); } to { transform: translateY(-6px); } }
.cutout { height: 100%; width: auto; object-fit: contain; display: block;
  filter: drop-shadow(0 30px 40px rgba(43,43,43,.28)); }

.meta { position: absolute; left: 60px; bottom: 150px; z-index: 4; display: flex; flex-direction: column; gap: 10px;
  animation: rise .5s ease-out 1.8s both; }
.name { font-family: var(--dub-font-display); font-style: italic; font-weight: 700; font-size: 56px; color: var(--dub-ink); }
.size { font-family: var(--dub-font-body); font-weight: 700; font-size: 30px; letter-spacing: 2px; color: var(--dub-ink); }
.sku { font-family: var(--dub-font-body); font-size: 22px; letter-spacing: 4px; color: var(--dub-ink); opacity: .6; }
.cta { position: absolute; left: 60px; bottom: 64px; z-index: 4;
  font-family: var(--dub-font-body); font-weight: 800; font-size: 30px; letter-spacing: 2px; color: var(--dub-soft);
  background: var(--dub-ink); padding: 16px 30px; border-radius: 99px;
  animation: rise .5s ease-out 2.0s both; }
@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 10: Generate preview + eyeball (check the gold price renders solid, not invisible)**

Run: `yarn regen-previews bigprice-cutout-hero`
Expected: giant gold price top-left, cutout standing bottom-right overlapping it, name/size/sku + DM CTA bottom-left. **Critical check:** the price number is visibly filled gold in the static preview (frame 0 should show the held/fallback gold, not transparent). If it's transparent, the regen sample text for `price` is `Rs.1100` — confirm `.rs` doubling looks OK; if the override already contains "Rs." set `.rs { display:none }`.

- [ ] **Step 11: Run the full unit suite (all modules, not just picker)**

Run: `yarn test:unit`
Expected: PASS — picker, template-loader, and all other unit tests green.

- [ ] **Step 12: Commit**

```bash
git add src/story-templates/bigprice-cutout-hero src/modules/stories-render/picker.ts src/modules/stories-render/__tests__/picker.unit.spec.ts
git commit -m "feat(stories): add bigprice-cutout-hero template (hard-gated)"
```

---

## Task 11: Day-simulation diversity test + final verification

Guards the enlarged pools against the "same template 3× in a day" regression and confirms all 10 previews exist.

**Files:**
- Test: `src/modules/stories-render/__tests__/picker.unit.spec.ts`

- [ ] **Step 1: Write a simulated-day diversity test**

```ts
it("a simulated day of 12 single-color front-only products never repeats a template 3x", () => {
  const counts = new Map<string, number>()
  for (let i = 0; i < 12; i++) {
    const s = snapshot({
      name: `Item ${i}`,
      price_mur: 900 + i,
      variants_in_stock: [color(`c${i}`, ["front"], { sku: `IS90${i}0-M-X`, sizes: ["S", "M"] })],
      variant_in_stock_count: 1,
    })
    const r = pickTemplate(s, i, counts)
    expect(r).not.toBeNull()
    counts.set(r!.template_slug, (counts.get(r!.template_slug) ?? 0) + 1)
  }
  // No single-image template should exceed MAX_TEMPLATE_PER_DAY (2).
  for (const [slug, n] of counts) {
    expect(n).toBeLessThanOrEqual(2)
  }
})
```

- [ ] **Step 2: Run it**

Run: `yarn test:unit picker.unit.spec.ts -t "simulated day"`
Expected: PASS (the existing `MAX_TEMPLATE_PER_DAY` cap + least-used rotation enforce ≤2; with 9 single-image templates and 12 products, distribution stays ≤2 each).

- [ ] **Step 3: Confirm all 10 previews were generated**

Run: `yarn regen-previews` (regenerates every template's preview)
Expected: completes with no `meta.json invalid` errors; each of the 10 new folders now has a `preview.jpg`.

- [ ] **Step 4: Full unit suite final pass**

Run: `yarn test:unit`
Expected: PASS across all unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/stories-render/__tests__/picker.unit.spec.ts src/story-templates
git commit -m "test(stories): day-simulation diversity guard + regenerate all previews"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Self-Review notes

- **Spec coverage:** all 10 templates → Tasks 1–10; picker wiring per bucket → Tasks 1 (1-color pool), 5 (2-color pool), 7 (back pool), 10 (cutout sites); hard-gating → Tasks 7 & 10 rely on the unreachable-without-image branches + explicit negative tests; testing strategy → per-task tests + Task 11 diversity guard + `regen-previews` eyeball; MP4 smoke for motion-heavy → Task 7 step 9 (cardflip). All brand rules (photo opacity 1, always-show-size, CTA) encoded in each `styles.css`/`index.html`.
- **Placeholder scan:** every step has concrete code/commands. The one judgment call (`.rs { display:none }` in Task 10) is an explicit eyeball decision with a stated trigger, not a TBD.
- **Type/name consistency:** slot ids (`hero`, `front_a`/`front_b`, `front`/`back`, `product_cutout`) match the picker's injected keys; `leastUsed`, `countOf`, `isSaturated`, `productNameLabel`, `collectSizes`, `sizesForVariant`, `pickCutout`, `pickBack` are all existing functions referenced consistently; new consts (`TWO_COLOR_FRONT_ROTATION`, `CUTOUT_ROTATION`) defined before use.
