import {
  isFbCrosspostEnabled,
  isMetaFbConfigured,
  readMetaFbEnv,
} from "../meta-fb"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  // Restore env between tests so order doesn't matter.
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

describe("readMetaFbEnv", () => {
  it("returns null when META_PAGE_ACCESS_TOKEN is missing", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns null when META_FB_PAGE_ID is missing", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    delete process.env.META_FB_PAGE_ID
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns config when both env vars are set", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.META_API_VERSION = "v21.0"
    expect(readMetaFbEnv()).toEqual({
      pageAccessToken: "token",
      pageId: "1234567890",
      apiVersion: "v21.0",
    })
  })

  it("defaults apiVersion to v21.0 when unset", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    delete process.env.META_API_VERSION
    expect(readMetaFbEnv()?.apiVersion).toBe("v21.0")
  })
})

describe("isMetaFbConfigured", () => {
  it("reflects readMetaFbEnv", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isMetaFbConfigured()).toBe(false)

    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isMetaFbConfigured()).toBe(true)
  })
})

describe("isFbCrosspostEnabled", () => {
  it("returns false when STORIES_CROSSPOST_FB is unset", () => {
    delete process.env.STORIES_CROSSPOST_FB
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when STORIES_CROSSPOST_FB is anything but the string 'true'", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.STORIES_CROSSPOST_FB = "1"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "yes"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "TRUE"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when flag is 'true' but creds missing", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns true when flag is 'true' AND creds present", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(true)
  })
})
