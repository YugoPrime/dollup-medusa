import { describe, expect, it } from "@jest/globals"
import fs from "node:fs/promises"
import path from "node:path"

import StoriesRenderModuleService from "../service"

const TEMPLATES_ROOT = path.resolve(__dirname, "../../../story-templates")

async function cleanup(tmpTemplateDir: string) {
  await fs.rm(path.dirname(tmpTemplateDir), { recursive: true, force: true })
}

describe("StoriesRenderModuleService", () => {
  it("materializes template into tmpdir with inputs injected", async () => {
    const svc = new StoriesRenderModuleService({ templatesRoot: TEMPLATES_ROOT, skipCli: true })
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
    const svc = new StoriesRenderModuleService({ templatesRoot: TEMPLATES_ROOT, skipCli: true })
    const tmpDir = await svc.materializeTemplate("in-stock-hero", {
      slot_inputs: { hero: "x" },
      text_overrides: {},
    })
    const html = await fs.readFile(path.join(tmpDir, "index.html"), "utf8")
    expect(html).toContain(">IN STOCK<")
    await cleanup(tmpDir)
  })

  it("validates required slots", async () => {
    const svc = new StoriesRenderModuleService({ templatesRoot: TEMPLATES_ROOT, skipCli: true })
    await expect(
      svc.materializeTemplate("in-stock-hero", { slot_inputs: {}, text_overrides: {} }),
    ).rejects.toThrow(/Required slot 'hero' is empty/)
  })

  it("copies the brand directory next to the materialized template", async () => {
    const svc = new StoriesRenderModuleService({ templatesRoot: TEMPLATES_ROOT, skipCli: true })
    const tmpDir = await svc.materializeTemplate("in-stock-hero", {
      slot_inputs: { hero: "x" },
      text_overrides: {},
    })
    await expect(fs.stat(path.join(path.dirname(tmpDir), "_brand"))).resolves.toBeTruthy()
    await cleanup(tmpDir)
  })
})

