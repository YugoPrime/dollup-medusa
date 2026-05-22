// NOTE: Task spec used vitest's `vi` API, but this repo runs Jest. The behaviour
// assertions are kept verbatim from the plan; only the `vi.*` calls are mapped
// to their Jest equivalents (`jest.fn`, `jest.mock`, `(global as any).fetch =`).
const uploadMock = jest.fn()
jest.mock("../../../../lib/r2-inbox-uploader", () => ({
  uploadInboxAttachmentToR2: (...args: unknown[]) => uploadMock(...args),
}))

import { rehostMetaAttachment } from "../rehost-meta-attachment"

const fetchMock = jest.fn()
beforeEach(() => {
  uploadMock.mockReset()
  fetchMock.mockReset()
  ;(global as any).fetch = fetchMock
})

describe("rehostMetaAttachment", () => {
  it("downloads and uploads when type=image", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff])
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Map([["content-type", "image/jpeg"]]) as any,
      arrayBuffer: async () => bytes.buffer.slice(0, 3),
    })
    uploadMock.mockResolvedValueOnce({
      url: "https://cdn.example.com/inbox/thr_1/abc.jpg",
      key: "inbox/thr_1/abc.jpg",
    })
    const result = await rehostMetaAttachment(
      { type: "image", url: "https://meta.example/x" },
      "thr_1",
    )
    expect(result).toEqual({
      kind: "image",
      url_r2: "https://cdn.example.com/inbox/thr_1/abc.jpg",
      mime: "image/jpeg",
      size: 3,
    })
  })

  it("returns null for non-image types in v1", async () => {
    const result = await rehostMetaAttachment(
      { type: "video", url: "https://meta.example/v" },
      "thr_1",
    )
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns null when fetch fails (preserves text-only message)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    })
    const result = await rehostMetaAttachment(
      { type: "image", url: "https://meta.example/x" },
      "thr_1",
    )
    expect(result).toBeNull()
  })

  it("returns null when URL missing", async () => {
    const result = await rehostMetaAttachment({ type: "image", url: "" }, "thr_1")
    expect(result).toBeNull()
  })
})
