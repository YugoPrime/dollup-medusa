import { hashTokenForTest } from "../service"

describe("preorder token hashing", () => {
  it("hashes the same plaintext to the same digest", () => {
    expect(hashTokenForTest("abc123")).toEqual(hashTokenForTest("abc123"))
  })

  it("hashes different plaintexts to different digests", () => {
    expect(hashTokenForTest("abc123")).not.toEqual(hashTokenForTest("abc124"))
  })

  it("produces a 64-char hex digest", () => {
    const h = hashTokenForTest("anything")
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
