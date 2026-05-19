import { readForcedTemplate } from "../batch"

describe("readForcedTemplate", () => {
  it("returns the slug when metadata.forced_template_slug is a non-empty string", () => {
    expect(readForcedTemplate({ forced_template_slug: "how-to-order" })).toBe(
      "how-to-order",
    )
    expect(readForcedTemplate({ forced_template_slug: "customer-review" })).toBe(
      "customer-review",
    )
  })

  it("returns null when metadata is null/undefined/non-object", () => {
    expect(readForcedTemplate(null)).toBeNull()
    expect(readForcedTemplate(undefined)).toBeNull()
    expect(readForcedTemplate("how-to-order")).toBeNull()
    expect(readForcedTemplate(42)).toBeNull()
  })

  it("returns null when forced_template_slug is missing, empty, or wrong type", () => {
    expect(readForcedTemplate({})).toBeNull()
    expect(readForcedTemplate({ forced_template_slug: "" })).toBeNull()
    expect(readForcedTemplate({ forced_template_slug: null })).toBeNull()
    expect(readForcedTemplate({ forced_template_slug: 123 })).toBeNull()
  })

  it("ignores other metadata keys (render, render_error, etc.)", () => {
    expect(
      readForcedTemplate({
        forced_template_slug: "how-to-order",
        render: { mp4_url: "https://x" },
        render_started_at: "2026-05-19",
      }),
    ).toBe("how-to-order")
  })
})
