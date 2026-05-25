# Cutout-Spotlight Gate Fix

**Date:** 2026-05-25
**Owner:** solo
**Status:** approved, ready for implementation

## Problem

`cutout-spotlight` and `cutout-spotlight-v2` story templates have never appeared in published stories despite:

- 239 cutout PNGs already uploaded to R2 (see `inventory-audit/data/cutouts-uploaded.json`)
- `product.metadata.cutout_image_url` set on those products
- `product-source.ts:toProductLike` correctly injecting the cutout URL into the variant image list
- A dedicated daily-guarantee branch in `picker.ts` that is supposed to force at least one cutout-spotlight per plan when eligible

## Root cause

`picker.ts:557` defines eligibility as:

```ts
const cutoutEligible = cutoutUrl != null && !hasRealShot(colors)
```

`hasRealShot(colors)` returns true when any variant has any `-r` / `-real` image. The R2 upload index shows 1317 of 1875 uploaded images are real shots — so the vast majority of the catalog has at least one real shot, which permanently blocks cutout-spotlight regardless of whether a cutout PNG exists.

The justification embedded in the code comments (lines 232–235 and 246–254) reads:

> "cutout-spotlight is intentionally suppressed when a real shot exists — lifestyle-overlay gives a stronger story for products with real photography."

That justification is stale. Per the 2026-05-19 boutique policy (memory: `stories-hero-no-fade-rule.md` neighborhood), **real shots are never used in any story template anymore.** `lifestyle-overlay` now uses front shots like every other template. The "stronger story with real photography" reasoning no longer applies because no template uses real photography at all.

## Fix

One change in `src/modules/stories-render/picker.ts`:

```ts
// before
const cutoutEligible = cutoutUrl != null && !hasRealShot(colors)
// after
const cutoutEligible = cutoutUrl != null
```

`hasRealShot` becomes dead code (no other callers) and is deleted along with its docstring.

The surrounding daily-guarantee logic (lines 575–595) is unchanged — it already does the right thing once eligibility is widened.

## Tests

`src/modules/stories-render/__tests__/picker.unit.spec.ts`:

- Any test asserting that cutout-spotlight is suppressed when a real shot is present is now incorrect. Invert or delete it.
- Add a positive test: when cutout URL is present AND a real shot is present, cutout-spotlight (or v2) is eligible.

Existing tests covering the daily-guarantee force-pick and the rotation pool composition do not need changes — they already exercise the eligible path.

## Out of scope

- Adding color/background variants of `cutout-spotlight-v2`, `product-1color`, `product-2colors`, `product-3colors` (deferred to a follow-up spec — original ask, gated on this fix landing first).
- Cutout-rendering quality, template typography, or new templates.
- Backfilling cutouts for products that don't yet have one.

## Verification after deploy

1. Trigger tomorrow's plan regeneration from `dollup-admin /stories`.
2. Inspect plan slots — confirm at least one is `cutout-spotlight` or `cutout-spotlight-v2`.
3. Preview the slot — confirm the cutout PNG renders cleanly on the template background.
4. Let the 18:00 MU `create-tomorrow-plan` cron run for one day; confirm cutout-spotlight appears in the next morning's published stories.

## Risk

Low. Worst case is cutout-spotlight fires too often, in which case its weight in the rotation pool can be tuned down without reverting the fix. The change does not touch published-stories dedup, the schedule-aware exclusion logic, or any cross-module wiring.
