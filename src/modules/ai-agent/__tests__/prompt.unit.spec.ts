import { buildSystemBlocks, BASE_SYSTEM_PROMPT } from "../lib/prompt"

const entries = [
  { id: "akn_1", title: "Livraison", body: "Livraison gratuite dès Rs 2000.", is_active: true },
  { id: "akn_2", title: "Retours", body: "Échange sous 7 jours.", is_active: true },
  { id: "akn_3", title: "Ancien", body: "Périmé.", is_active: false },
]

describe("buildSystemBlocks", () => {
  it("returns exactly one block so the whole prefix caches as a unit", () => {
    expect(buildSystemBlocks(entries)).toHaveLength(1)
  })

  it("puts a cache breakpoint on the block", () => {
    expect(buildSystemBlocks(entries)[0].cache_control).toEqual({ type: "ephemeral" })
  })

  it("includes active knowledge and excludes inactive", () => {
    const text = buildSystemBlocks(entries)[0].text
    expect(text).toContain("Livraison gratuite dès Rs 2000.")
    expect(text).toContain("Échange sous 7 jours.")
    expect(text).not.toContain("Périmé.")
  })

  it("is byte-identical across calls with the same input — the cache depends on it", () => {
    expect(buildSystemBlocks(entries)[0].text).toBe(buildSystemBlocks(entries)[0].text)
  })

  it("orders entries by id so row order from the DB cannot vary the prefix", () => {
    const shuffled = [entries[1], entries[0], entries[2]]
    expect(buildSystemBlocks(shuffled)[0].text).toBe(buildSystemBlocks(entries)[0].text)
  })

  it("contains no timestamp, session id, or other volatile token", () => {
    const text = buildSystemBlocks(entries)[0].text
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(text).not.toMatch(/session/i)
  })

  it("carries the hard guardrails", () => {
    const text = buildSystemBlocks(entries)[0].text
    expect(text).toContain("jamais")
    expect(BASE_SYSTEM_PROMPT).toContain("send_reply")
  })

  it("works with no knowledge entries at all", () => {
    const blocks = buildSystemBlocks([])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toContain(BASE_SYSTEM_PROMPT.slice(0, 40))
  })

  it("is at least 1024 characters, the floor below which nothing caches", () => {
    // Sonnet 5 will not create a cache entry for a prefix under ~1024 tokens.
    // Characters are a rough proxy but a useful tripwire: if the base prompt is
    // ever trimmed below this, caching silently stops and every run pays full
    // price for the whole prefix.
    expect(buildSystemBlocks([])[0].text.length).toBeGreaterThan(1024)
  })
})
