// NOTE: Task spec used vitest's `vi` API, but this repo runs Jest (see
// package.json -> "test:unit"). The behaviour assertions are kept verbatim; only
// the `vi.*` calls are mapped to their Jest equivalents (`jest.fn`, `jest.mock`).
const listMock = jest.fn()
const deleteMock = jest.fn()
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: (cmd: { __cmd: string }) =>
      cmd.__cmd === "List" ? listMock(cmd) : deleteMock(cmd),
  })),
  ListObjectsV2Command: jest.fn((input) => ({ __cmd: "List", input })),
  DeleteObjectsCommand: jest.fn((input) => ({ __cmd: "Delete", input })),
}))

import { sweepInboxR2 } from "../cleanup-stale-inbox-attachments"

beforeEach(() => {
  listMock.mockReset()
  deleteMock.mockReset()
  process.env.R2_ENDPOINT = "https://x.r2.cloudflarestorage.com"
  process.env.R2_ACCESS_KEY_ID = "k"
  process.env.R2_SECRET_ACCESS_KEY = "s"
  process.env.R2_BUCKET = "doll"
})

describe("sweepInboxR2", () => {
  it("deletes objects older than retentionDays", async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    const fresh = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    listMock.mockResolvedValueOnce({
      Contents: [
        { Key: "inbox/thr_1/aaa.jpg", LastModified: old, Size: 1000 },
        { Key: "inbox/thr_1/bbb.jpg", LastModified: fresh, Size: 1000 },
      ],
      IsTruncated: false,
    })
    deleteMock.mockResolvedValueOnce({ Errors: [] })
    const result = await sweepInboxR2({ retentionDays: 90, dryRun: false })
    expect(result.scanned).toBe(2)
    expect(result.deleted).toBe(1)
    expect(result.kept).toBe(1)
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })

  it("dry-run lists but does not delete", async () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    listMock.mockResolvedValueOnce({
      Contents: [{ Key: "inbox/thr_1/aaa.jpg", LastModified: old, Size: 1000 }],
      IsTruncated: false,
    })
    const result = await sweepInboxR2({ retentionDays: 90, dryRun: true })
    expect(result.deleted).toBe(1)
    expect(result.bytes_freed).toBe(1000)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("no-op when bucket missing", async () => {
    delete process.env.R2_BUCKET
    const result = await sweepInboxR2({ retentionDays: 90, dryRun: false })
    expect(result.scanned).toBe(0)
  })
})
