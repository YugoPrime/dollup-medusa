import { describe, expect, it } from "@jest/globals"
import path from "node:path"

import { listTemplates, loadTemplate } from "../template-loader"

const TEMPLATES_ROOT = path.resolve(__dirname, "../../../story-templates")
const FIXTURES_ROOT = path.resolve(__dirname, "__fixtures__")

describe("template-loader", () => {
  it("loads in-stock-hero meta with correct shape", async () => {
    const meta = await loadTemplate("in-stock-hero", TEMPLATES_ROOT)
    expect(meta.slug).toBe("in-stock-hero")
    expect(meta.category).toBe("single-product")
    expect(meta.slots).toHaveLength(1)
    expect(meta.slots[0].id).toBe("hero")
    expect(meta.slots[0].required).toBe(true)
  })

  it("throws TemplateNotFoundError for unknown slug", async () => {
    await expect(loadTemplate("does-not-exist", TEMPLATES_ROOT)).rejects.toThrow(
      /Template not found/,
    )
  })

  it("rejects template with malformed meta.json", async () => {
    await expect(loadTemplate("_malformed_for_test", FIXTURES_ROOT)).rejects.toThrow(
      /Template not found|meta\.json invalid/,
    )
  })

  it("lists all templates excluding private folders", async () => {
    // 2026-05-25: round-1 palette variants added — product-1color,
    // product-1color-featured, new-drop-arch, product-2colors each cloned
    // into -blush / -cream / -sage / -coral siblings (16 new folders).
    // 2026-05-30: editorial 1-color (split-thirds-editorial, receipt-tag-1color,
    // framed-gallery-1color), 2-color-front wipe siblings (diagonal-2color-wipe,
    // swipe-through-2color), and back template cardflip-front-back added.
    const slugs = (await listTemplates(TEMPLATES_ROOT)).map((template) => template.slug)
    expect(slugs).toEqual([
      "cardflip-front-back",
      "color-mood-rail",
      "customer-review",
      "cutout-spotlight",
      "cutout-spotlight-v2",
      "diagonal-2color-wipe",
      "editorial-cover-hero",
      "framed-gallery-1color",
      "how-to-order",
      "in-stock-hero",
      "in-stock-hero-blush",
      "in-stock-hero-cream",
      "just-arrived-editorial",
      "lifestyle-overlay",
      "many-photos",
      "new-arrival",
      "new-drop-arch",
      "new-drop-arch-blush",
      "new-drop-arch-coral",
      "new-drop-arch-cream",
      "new-drop-arch-sage",
      "on-sale",
      "product-1color",
      "product-1color-blush",
      "product-1color-coral",
      "product-1color-cream",
      "product-1color-featured",
      "product-1color-featured-blush",
      "product-1color-featured-coral",
      "product-1color-featured-cream",
      "product-1color-featured-sage",
      "product-1color-sage",
      "product-2colors",
      "product-2colors-blush",
      "product-2colors-coral",
      "product-2colors-cream",
      "product-2colors-front",
      "product-2colors-sage",
      "product-3colors",
      "receipt-tag-1color",
      "split-thirds-editorial",
      "swipe-through-2color",
    ])
  })
})

