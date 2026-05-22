// NOTE: Task spec used vitest's `vi` API, but this repo runs Jest (see
// package.json -> "test:unit"). The behaviour assertions are kept verbatim; only
// the `vi.*` calls are mapped to their Jest equivalents (`jest.fn`, `jest.mock`).
const sendMock = jest.fn()
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn((input) => ({ __cmd: "Put", input })),
}))

import { buildInboxKey, uploadInboxAttachmentToR2 } from "../r2-inbox-uploader"

describe("buildInboxKey", () => {
  it("produces stable shape inbox/<threadId>/<hash>.<ext>", () => {
    const k = buildInboxKey("thr_01ABC", "image/jpeg", Buffer.from("hi"))
    expect(k).toMatch(/^inbox\/thr_01ABC\/[a-f0-9]{16,}\.jpg$/)
  })

  it("maps image/png to .png and image/webp to .webp", () => {
    expect(buildInboxKey("thr_X", "image/png", Buffer.from("a"))).toMatch(/\.png$/)
    expect(buildInboxKey("thr_X", "image/webp", Buffer.from("a"))).toMatch(/\.webp$/)
  })

  it("falls back to .bin for unknown mime", () => {
    expect(buildInboxKey("thr_X", "application/unknown", Buffer.from("a"))).toMatch(/\.bin$/)
  })
})

describe("uploadInboxAttachmentToR2", () => {
  const ENV_KEYS = [
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_URL",
  ]
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    ENV_KEYS.forEach((k) => (saved[k] = process.env[k]))
    sendMock.mockReset()
  })
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    })
  })

  it("throws when R2_BUCKET missing", async () => {
    process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com"
    process.env.R2_ACCESS_KEY_ID = "k"
    process.env.R2_SECRET_ACCESS_KEY = "s"
    delete process.env.R2_BUCKET
    process.env.R2_PUBLIC_URL = "https://cdn.example.com"
    await expect(
      uploadInboxAttachmentToR2(Buffer.from("x"), "image/jpeg", "thr_1"),
    ).rejects.toThrow(/R2 not configured/)
  })

  it("uploads and returns public URL", async () => {
    process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com"
    process.env.R2_ACCESS_KEY_ID = "k"
    process.env.R2_SECRET_ACCESS_KEY = "s"
    process.env.R2_BUCKET = "doll"
    process.env.R2_PUBLIC_URL = "https://cdn.example.com/"
    sendMock.mockResolvedValueOnce({})
    const out = await uploadInboxAttachmentToR2(
      Buffer.from("payload"),
      "image/jpeg",
      "thr_42",
    )
    expect(out.url).toMatch(/^https:\/\/cdn\.example\.com\/inbox\/thr_42\/[a-f0-9]+\.jpg$/)
    expect(out.key).toMatch(/^inbox\/thr_42\//)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
