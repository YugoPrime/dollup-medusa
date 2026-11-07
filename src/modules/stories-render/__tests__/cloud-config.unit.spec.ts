import { describe, expect, it } from "@jest/globals"

import { readCloudRenderConfig } from "../cloud/config"
import { resolveRenderMode } from "../cloud/mode"

const good = {
  STORY_RENDER_URL: "https://render.example.workers.dev/",
  STORY_RENDER_API_KEY: "key-secret-1",
  STORY_RENDER_CALLBACK_SECRET: "cb-secret-2",
} as NodeJS.ProcessEnv

describe("resolveRenderMode", () => {
  it("defaults to local, trims and lowercases, ignores unknowns", () => {
    expect(resolveRenderMode({})).toBe("local")
    expect(resolveRenderMode({ STORIES_RENDER_MODE: " CLOUD " })).toBe("cloud")
    expect(resolveRenderMode({ STORIES_RENDER_MODE: "shadow" })).toBe("shadow")
    expect(resolveRenderMode({ STORIES_RENDER_MODE: "laptop" })).toBe("local")
  })
})

describe("readCloudRenderConfig", () => {
  it("reads values, strips trailing slash, defaults the callback url", () => {
    expect(readCloudRenderConfig(good)).toEqual({
      baseUrl: "https://render.example.workers.dev",
      apiKey: "key-secret-1",
      callbackSecret: "cb-secret-2",
      callbackUrl: "https://api.dollupboutique.com/hooks/story-render",
    })
  })

  it("honours an explicit callback url", () => {
    const cfg = readCloudRenderConfig({
      ...good,
      STORY_RENDER_CALLBACK_URL: "https://x.example.com/cb",
    })
    expect(cfg.callbackUrl).toBe("https://x.example.com/cb")
  })

  it("names a missing variable and leaks no other value", () => {
    const env = { ...good }
    delete env.STORY_RENDER_API_KEY
    let msg = ""
    try {
      readCloudRenderConfig(env)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toBe("STORY_RENDER_API_KEY is not set")
    expect(msg).not.toContain("cb-secret-2")
    expect(msg).not.toContain("render.example")
  })

  it("throws for the other missing variables", () => {
    for (const name of ["STORY_RENDER_URL", "STORY_RENDER_CALLBACK_SECRET"]) {
      const env = { ...good, [name]: "  " }
      expect(() => readCloudRenderConfig(env)).toThrow(`${name} is not set`)
    }
  })

  it("requires https for both urls", () => {
    expect(() =>
      readCloudRenderConfig({
        ...good,
        STORY_RENDER_URL: "http://a.example.com",
      })
    ).toThrow("STORY_RENDER_URL must be https")
    expect(() =>
      readCloudRenderConfig({
        ...good,
        STORY_RENDER_CALLBACK_URL: "http://a.example.com/cb",
      })
    ).toThrow("STORY_RENDER_CALLBACK_URL must be https")
  })
})
