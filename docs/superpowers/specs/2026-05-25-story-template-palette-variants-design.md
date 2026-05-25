# Story Template Palette Variants — Round 1

**Date:** 2026-05-25
**Owner:** solo
**Status:** approved, ready for implementation

## Goal

The daily stories feed feels visually repetitive even though the picker rotates 5+ templates. Reason: each non-hero template has exactly one palette, so the same product on consecutive days reads "same" even when the layout differs. Goal is to give the high-frequency 1-color and 2-color templates the same palette-variant treatment that `in-stock-hero-blush` / `in-stock-hero-cream` already provide on the hero.

## Approach

Clone each target template into 4 palette siblings. Same slot contract, same text overrides, only the background / accent CSS changes. Picker rotates between siblings; no business-logic change.

This is the proven pattern from 2026-05-22 (`in-stock-hero-blush` / `in-stock-hero-cream`).

## Targets

4 templates × 4 palettes = 16 new template folders.

| Template | Slot contract | Pool |
|---|---|---|
| `product-1color` | front, back | `ONE_COLOR_FRONT_BACK_ROTATION` |
| `product-1color-featured` | front, back | `ONE_COLOR_FRONT_BACK_ROTATION` |
| `new-drop-arch` | front, back | `ONE_COLOR_FRONT_BACK_ROTATION` |
| `product-2colors` | front_a, front_b, back | (inline in picker, not a rotation array) |

**Excluded:**
- `cutout-spotlight-v2` — picker already rotates v1 ↔ v2 (just unblocked in `ef03fdb`), don't dilute further until that rotation has shipped a week of stories.
- `product-3colors` — already rotates with `color-mood-rail`; revisit if/when 3-color products start feeling repetitive.
- `lifestyle-overlay` / `just-arrived-editorial` / `in-stock-hero` — already in `SINGLE_IMAGE_ROTATION` with blush/cream variants of hero.
- `customer-review`, `how-to-order`, `many-photos`, `new-arrival`, `on-sale` — semantics tied to color (sale red, new-arrival NEW stamp) or low-frequency / ops.

## Palettes

| Suffix | Background | Accent text | Status |
|---|---|---|---|
| `-blush` | `--dub-blush` → `--dub-pink` linear gradient | `--dub-ink` on `--dub-cream` chips | proven on hero |
| `-cream` | `--dub-soft` → `--dub-cream` linear gradient | `--dub-gold` accents | proven on hero |
| `-sage` (new) | sage `#e6ede2` → `#cfdcc5` linear gradient | `--dub-ink` on cream chips | botanical/calm |
| `-coral` (new) | `--dub-coral` → muted coral gradient | `--dub-cream` text on `--dub-ink` chips | sunset/bold |

Two new CSS tokens needed in `_brand/tokens.css`:
- `--dub-sage: #e6ede2;`
- `--dub-sage-deep: #cfdcc5;`

(`--dub-coral` already exists; `--dub-cream` / `--dub-ink` already exist.)

## Picker changes

`src/modules/stories-render/picker.ts`:

```ts
// extend the existing rotation
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
] as const

// new 2-color rotation (currently inline / no rotation array)
const TWO_COLOR_ROTATION = [
  "product-2colors",
  "product-2colors-blush",
  "product-2colors-cream",
  "product-2colors-sage",
  "product-2colors-coral",
] as const
```

The 2-color branch (currently lines 478–504) is rewritten to use `leastUsed(TWO_COLOR_ROTATION, pickedSoFar)` when `pickedSoFar` is provided, falling back to `product-2colors` when not — preserves deterministic test behavior. The `product-2colors-front` fallback (no back available) is unchanged: it stays as the single fallback when no back exists.

`MAX_TEMPLATE_PER_DAY = 2` still applies. With 15 entries in the 1-color pool, saturation is now functionally impossible in a typical 8-slot day — that's fine, the cap exists to prevent the *same* template firing 3× and is unaffected.

## Tests

`src/modules/stories-render/__tests__/picker.unit.spec.ts`:

- Update existing rotation-length assertions (any test asserting `ONE_COLOR_FRONT_BACK_ROTATION.length === 3` or similar).
- Add: when `pickedSoFar` is empty, slot 0 of a 1-color front+back product picks `product-1color` (deterministic head of rotation).
- Add: when `pickedSoFar` is populated, the 1-color rotation picks land least-used (verifies the leastUsed branch over the new 15-template pool).
- Add: 2-color rotation produces 5 distinct slugs over 5 slots when `pickedSoFar` is provided.
- Update any test that previously asserted `product-2colors` was the only 2-color-with-back choice.

## Implementation steps

1. Add `--dub-sage` and `--dub-sage-deep` to `_brand/tokens.css`.
2. For each of 4 templates, clone the folder 4 times (one per palette). For each clone:
   - Update `meta.json`: change `slug` and `name`, leave slots and text_overrides untouched.
   - Update `styles.css`: replace background + accent color rules.
   - `index.html` is copied verbatim — same DOM, same data-bindings.
3. Update `picker.ts` rotation arrays.
4. Update tests.
5. Run `yarn jest` on stories-render — must be 100% green.
6. Regenerate template previews: `yarn tsx src/scripts/regen-template-previews.ts` (admin uses these for the slot UI).
7. Manually preview one product through each new variant via `dollup-admin /stories` before claiming done.

## Verification after deploy

1. Trigger plan regeneration for tomorrow.
2. Confirm at least 6 distinct 1-color slugs appear in the day's slot list (was: 3 max).
3. Confirm 2-color products land on at least 2 distinct slugs across the week.
4. Visually scan a generated day — feed should read as 4 distinct color stories per template family, not "same shape, same color, again."

## Risk

Low. Pure template additions + a rotation array extension. The 2-color branch refactor is the only logic change — covered by tests. Worst case: a palette reads off-brand and gets removed (delete the 4 folders for that palette, drop the slugs from the rotation arrays — no data migration).

## Round 2 (deferred)

- `product-3colors` palette variants once you've seen 3-color rotation feel stale
- `lifestyle-overlay` / `just-arrived-editorial` palette variants if hero rotation still reads repetitive after this round ships
- `cutout-spotlight-v2` palette variants after the gate-fix has logged a week of cutout stories
