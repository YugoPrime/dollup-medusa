import { POST } from "../../../api/admin/newsletter/subscribers/import/route"

function call(body: unknown) {
  const service = {
    importSubscribers: jest.fn(async () => ({ added: [], skipped: 0, unsubscribed: [] })),
  }
  const logger = { info: jest.fn(), error: jest.fn() }
  const req = {
    body,
    scope: { resolve: (key: string) => (key === "logger" ? logger : service) },
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
  return { req, res, service, logger, run: () => POST(req as any, res) }
}

describe("POST /admin/newsletter/subscribers/import", () => {
  it("refuses an After Dark import in Part 1 (R18), before writing anything", async () => {
    const t = call({ list: "after_dark", csv: "email\na@x.mu\n" })
    await t.run()
    expect(t.res.statusCode).toBe(400)
    expect(t.res.body).toEqual({ message: "In Part 1 the CSV import goes to the Main list only." })
    expect(t.service.importSubscribers).not.toHaveBeenCalled()
  })

  it("still rejects an unknown list with the list message", async () => {
    const t = call({ list: "vip", csv: "email\na@x.mu\n" })
    await t.run()
    expect(t.res.statusCode).toBe(400)
    expect(t.res.body).toEqual({ message: "list must be main or after_dark" })
  })

  it("reports how many CSV rows were unsubscribed (csv_unsubscribed)", async () => {
    const t = call({ list: "main", csv: "email,unsubscribed\na@x.mu,true\nb@x.mu,false\nc@x.mu,yes\n" })
    await t.run()
    expect(t.res.statusCode).toBe(200)
    expect(t.res.body).toEqual({ added: 0, skipped: 0, invalid: 0, sync_pending: 0, csv_unsubscribed: 2 })
    expect(t.service.importSubscribers).toHaveBeenCalledWith("main", [
      { email: "a@x.mu", unsubscribed: true },
      { email: "b@x.mu", unsubscribed: false },
      { email: "c@x.mu", unsubscribed: true },
    ])
  })

  it("turns an unrecognised opt-out value into a 400 naming the row, and imports nothing", async () => {
    const t = call({ list: "main", csv: "email,unsubscribed\na@x.mu,false\nb@x.mu,maybe\n" })
    await t.run()
    expect(t.res.statusCode).toBe(400)
    expect(t.res.body).toEqual({ message: 'Row 2: unsubscribed value "maybe" not recognised' })
    expect(t.service.importSubscribers).not.toHaveBeenCalled()
  })
})
