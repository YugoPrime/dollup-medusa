import { POST } from "../../../api/admin/newsletter/campaigns/[id]/send/route"
import { parseExpectedList } from "../route-deps"

describe("parseExpectedList", () => {
  it("is optional", () => {
    expect(parseExpectedList(undefined)).toBeUndefined()
    expect(parseExpectedList(null)).toBeUndefined()
  })
  it("accepts the two lists", () => {
    expect(parseExpectedList("main")).toBe("main")
    expect(parseExpectedList("after_dark")).toBe("after_dark")
  })
  it.each(["", "vip", 1, true, ["main"]])("rejects %p", (raw) => {
    expect(() => parseExpectedList(raw)).toThrow("expected_list must be main or after_dark")
  })
})

describe("POST /admin/newsletter/campaigns/:id/send", () => {
  it("answers 400 for a bad expected_list before building any Resend deps", async () => {
    const logger = { error: jest.fn() }
    const req = {
      body: { sent_by: "rahvi", expected_list: "vip" },
      params: { id: "nlcamp_1" },
      scope: {
        resolve: jest.fn((key: string) => {
          if (key === "logger") return logger
          throw new Error("must not resolve " + key)
        }),
      },
    }
    const res: any = { statusCode: 200, body: undefined }
    res.status = (s: number) => {
      res.statusCode = s
      return res
    }
    res.json = (b: unknown) => {
      res.body = b
      return res
    }
    await POST(req as any, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ message: "expected_list must be main or after_dark" })
  })
})
