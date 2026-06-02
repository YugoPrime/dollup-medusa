import { afterEach, describe, expect, it, jest } from "@jest/globals"
import fs from "node:fs/promises"
import path from "node:path"

import StoriesRenderModuleService, { inlineImageAsDataUri } from "../service"

const TEMPLATES_ROOT = path.resolve(__dirname, "../../../story-templates")

async function cleanup(tmpTemplateDir: string) {
  await fs.rm(path.dirname(tmpTemplateDir), { recursive: true, force: true })
}

describe("StoriesRenderModuleService", () => {
  it("materializes template into tmpdir with inputs injected", async () => {
    const svc = new StoriesRenderModuleService(null, {
      templatesRoot: TEMPLATES_ROOT,
      skipCli: true,
      // Identity resolver keeps these tests hermetic — the raw URL flows
      // straight into <img src> with no network fetch.
      resolveImage: async (url) => url,
    })
    const tmpDir = await svc.materializeTemplate("in-stock-hero", {
      slot_inputs: { hero: "https://example.com/test.jpg" },
      text_overrides: { headline: "MY HEADLINE" },
    })
    const html = await fs.readFile(path.join(tmpDir, "index.html"), "utf8")
    expect(html).toContain('src="https://example.com/test.jpg"')
    expect(html).toContain(">MY HEADLINE<")
    expect(html).not.toContain(">IN STOCK<")
    await cleanup(tmpDir)
  })

  it("uses default text when override is absent", async () => {
    const svc = new StoriesRenderModuleService(null, {
      templatesRoot: TEMPLATES_ROOT,
      skipCli: true,
      // Identity resolver keeps these tests hermetic — the raw URL flows
      // straight into <img src> with no network fetch.
      resolveImage: async (url) => url,
    })
    const tmpDir = await svc.materializeTemplate("in-stock-hero", {
      slot_inputs: { hero: "x" },
      text_overrides: {},
    })
    const html = await fs.readFile(path.join(tmpDir, "index.html"), "utf8")
    expect(html).toContain(">IN STOCK<")
    await cleanup(tmpDir)
  })

  it("validates required slots", async () => {
    const svc = new StoriesRenderModuleService(null, {
      templatesRoot: TEMPLATES_ROOT,
      skipCli: true,
      // Identity resolver keeps these tests hermetic — the raw URL flows
      // straight into <img src> with no network fetch.
      resolveImage: async (url) => url,
    })
    await expect(
      svc.materializeTemplate("in-stock-hero", { slot_inputs: {}, text_overrides: {} }),
    ).rejects.toThrow(/Required slot 'hero' is empty/)
  })

  it("copies the brand directory next to the materialized template", async () => {
    const svc = new StoriesRenderModuleService(null, {
      templatesRoot: TEMPLATES_ROOT,
      skipCli: true,
      // Identity resolver keeps these tests hermetic — the raw URL flows
      // straight into <img src> with no network fetch.
      resolveImage: async (url) => url,
    })
    const tmpDir = await svc.materializeTemplate("in-stock-hero", {
      slot_inputs: { hero: "x" },
      text_overrides: {},
    })
    await expect(fs.stat(path.join(path.dirname(tmpDir), "_brand"))).resolves.toBeTruthy()
    await cleanup(tmpDir)
  })
})

describe("inlineImageAsDataUri", () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    jest.restoreAllMocks()
  })

  function mockFetch(impl: () => Response | Promise<Response>): void {
    // @ts-expect-error — overriding the global for the test
    globalThis.fetch = jest.fn(impl)
  }

  it("returns non-http inputs unchanged (data URI, local path, test sentinel)", async () => {
    expect(await inlineImageAsDataUri("x")).toBe("x")
    expect(await inlineImageAsDataUri("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    )
    expect(await inlineImageAsDataUri("/local/path.jpg")).toBe("/local/path.jpg")
  })

  it("inlines a fetched image as a base64 data URI using the response content-type", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02])
    mockFetch(
      () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    )
    const out = await inlineImageAsDataUri("https://r2.example.com/photo.jpg")
    expect(out).toBe(`data:image/jpeg;base64,${bytes.toString("base64")}`)
  })

  it("sniffs the mime from magic bytes when content-type is generic", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    mockFetch(
      () =>
        new Response(png, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    )
    const out = await inlineImageAsDataUri("https://drive.example.com/file")
    expect(out).toBe(`data:image/png;base64,${png.toString("base64")}`)
  })

  it("falls back to the raw URL on a non-200 response", async () => {
    const url = "https://r2.example.com/missing.jpg"
    mockFetch(() => new Response("nope", { status: 404 }))
    expect(await inlineImageAsDataUri(url)).toBe(url)
  })

  it("falls back to the raw URL when fetch throws", async () => {
    const url = "https://r2.example.com/boom.jpg"
    mockFetch(() => {
      throw new Error("network down")
    })
    expect(await inlineImageAsDataUri(url)).toBe(url)
  })

  it("falls back to the raw URL when the body is not a recognizable image", async () => {
    const url = "https://r2.example.com/page.html"
    mockFetch(
      () =>
        new Response(Buffer.from("<html></html>"), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    )
    expect(await inlineImageAsDataUri(url)).toBe(url)
  })
})

