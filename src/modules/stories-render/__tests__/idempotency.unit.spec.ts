import { describe, expect, it } from "@jest/globals"

import { r2KeyFor, renderHash } from "../idempotency"

describe("idempotency", () => {
  it("renderHash is stable across calls for same inputs", () => {
    const inputs = {
      template_slug: "in-stock-hero",
      slot_inputs: { hero: "https://r2.example.com/img/abc.jpg" },
      text_overrides: { headline: "IN STOCK" },
    }
    expect(renderHash(inputs)).toBe(renderHash(inputs))
  })

  it("renderHash is order-independent on object keys", () => {
    const a = {
      template_slug: "x",
      slot_inputs: { a: "1", b: "2" },
      text_overrides: { y: "1", z: "2" },
    }
    const b = {
      template_slug: "x",
      slot_inputs: { b: "2", a: "1" },
      text_overrides: { z: "2", y: "1" },
    }
    expect(renderHash(a)).toBe(renderHash(b))
  })

  it("renderHash differs when any input changes", () => {
    const base = { template_slug: "x", slot_inputs: { a: "1" }, text_overrides: {} }
    expect(renderHash(base)).not.toBe(renderHash({ ...base, template_slug: "y" }))
    expect(renderHash(base)).not.toBe(
      renderHash({ ...base, slot_inputs: { a: "2" } }),
    )
    expect(renderHash(base)).not.toBe(
      renderHash({ ...base, text_overrides: { h: "1" } }),
    )
  })

  it("r2KeyFor combines slot id and hash", () => {
    expect(r2KeyFor("slot_abc", "deadbeef1234")).toBe(
      "stories/slot_abc/deadbeef1234.mp4",
    )
  })
})

