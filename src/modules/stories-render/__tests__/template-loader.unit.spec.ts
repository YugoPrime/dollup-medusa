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
    const slugs = (await listTemplates(TEMPLATES_ROOT)).map((template) => template.slug)
    expect(slugs).toEqual([
      "full-reveal",
      "how-to-order",
      "in-stock-hero",
      "lifestyle-overlay",
      "new-arrival",
      "on-sale",
    ])
  })
})

