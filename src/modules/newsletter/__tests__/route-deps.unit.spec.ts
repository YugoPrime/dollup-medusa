import { MedusaError } from "@medusajs/framework/utils"

import {
  buildCampaignDeps,
  errorBody,
  httpStatusFor,
  sendError,
  syncImportedRows,
} from "../route-deps"
import type { SubscriberDTO } from "../types"

describe("httpStatusFor", () => {
  it.each([
    [MedusaError.Types.INVALID_DATA, 400],
    [MedusaError.Types.CONFLICT, 409],
    [MedusaError.Types.NOT_FOUND, 404],
    [MedusaError.Types.UNEXPECTED_STATE, 500],
    [MedusaError.Types.DB_ERROR, 500],
  ])("maps %s to %i", (type, status) => {
    expect(httpStatusFor(new MedusaError(type, "x"))).toBe(status)
  })

  it("maps a plain Error and non-errors to 500", () => {
    expect(httpStatusFor(new Error("boom"))).toBe(500)
    expect(httpStatusFor("nope")).toBe(500)
    expect(httpStatusFor(undefined)).toBe(500)
  })
})

describe("errorBody / sendError", () => {
  const fakeRes = () => {
    const res: any = { statusCode: 0, body: null }
    res.status = (s: number) => {
      res.statusCode = s
      return res
    }
    res.json = (b: unknown) => {
      res.body = b
      return res
    }
    return res
  }

  it("keeps a CONFLICT message verbatim", () => {
    const err = new MedusaError(MedusaError.Types.CONFLICT, "campaign is already sent or sending")
    expect(errorBody(err)).toEqual({ message: "campaign is already sent or sending" })
    const res = fakeRes()
    sendError(res, err)
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ message: "campaign is already sent or sending" })
  })

  it("keeps a plain Error message and logs 500s only", () => {
    const logger = { error: jest.fn() }
    const res = fakeRes()
    sendError(res, new Error("You have reached your contacts quota."), logger)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ message: "You have reached your contacts quota." })
    expect(logger.error).toHaveBeenCalledTimes(1)

    const res2 = fakeRes()
    sendError(res2, new MedusaError(MedusaError.Types.INVALID_DATA, "bad"), logger)
    expect(res2.statusCode).toBe(400)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it("falls back for non-Error values", () => {
    expect(errorBody("weird")).toEqual({ message: "weird" })
    expect(errorBody(undefined)).toEqual({ message: "Unexpected error" })
  })
})

describe("buildCampaignDeps", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("throws the config error when RESEND_FROM_EMAIL is unset", () => {
    process.env.RESEND_API_KEY = "re_x"
    delete process.env.RESEND_NEWSLETTER_API_KEY
    delete process.env.RESEND_FROM_EMAIL
    const scope = { resolve: () => ({}) }
    expect(() => buildCampaignDeps(scope as any)).toThrow(/RESEND_FROM_EMAIL/)
  })
})

describe("syncImportedRows", () => {
  const row = (email: string, unsub = false) =>
    ({ id: "id_" + email, email, status: unsub ? "unsubscribed" : "subscribed" }) as SubscriberDTO
  const mk = () => {
    const service = { markSynced: jest.fn(), markSyncError: jest.fn() }
    const logger = { info: jest.fn(), error: jest.fn() }
    return { service, logger }
  }

  it("pushes unsubscribed rows with unsubscribed: true and marks synced", async () => {
    const { service, logger } = mk()
    const resend = {
      ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c1" }),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: "seg" }) },
      "main",
      [row("a@x.com"), row("b@x.com", true)],
      logger,
    )
    expect(resend.ensureContact).toHaveBeenNthCalledWith(1, "a@x.com", "seg", false)
    expect(resend.ensureContact).toHaveBeenNthCalledWith(2, "b@x.com", "seg", true)
    expect(service.markSynced).toHaveBeenCalledWith("id_a@x.com", "c1")
    expect(out).toEqual({ synced: 2, failed: 0 })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("synced 2, failed 0"))
  })

  it("records a failing ensureContact and a throwing one, and continues", async () => {
    const { service, logger } = mk()
    const resend = {
      ensureContact: jest
        .fn()
        .mockResolvedValueOnce({ ok: false, error: "quota" })
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ ok: true, contactId: null }),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: "seg" }) },
      "main",
      [row("a@x.com"), row("b@x.com"), row("c@x.com")],
      logger,
    )
    expect(service.markSyncError).toHaveBeenCalledWith("id_a@x.com", "quota")
    expect(service.markSyncError).toHaveBeenCalledWith("id_b@x.com", "network")
    expect(service.markSynced).toHaveBeenCalledWith("id_c@x.com", null)
    expect(out).toEqual({ synced: 1, failed: 2 })
  })

  it("marks every row when the segment/config is missing, and never throws", async () => {
    const { service, logger } = mk()
    const out = await syncImportedRows(
      {
        service,
        getResend: () => {
          throw new Error("RESEND_NEWSLETTER_SEGMENT_MAIN is not set")
        },
      },
      "main",
      [row("a@x.com"), row("b@x.com")],
      logger,
    )
    expect(service.markSyncError).toHaveBeenCalledTimes(2)
    expect(service.markSyncError).toHaveBeenCalledWith(
      "id_a@x.com",
      "RESEND_NEWSLETTER_SEGMENT_MAIN is not set",
    )
    expect(out).toEqual({ synced: 0, failed: 2 })
  })

  it("never throws even when markSynced itself fails", async () => {
    const { logger } = mk()
    const service = {
      markSynced: jest.fn().mockRejectedValue(new Error("db down")),
      markSyncError: jest.fn().mockRejectedValue(new Error("db down")),
    }
    const resend = { ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c" }) }
    await expect(
      syncImportedRows(
        { service, getResend: () => ({ resend: resend as any, segmentId: "s" }) },
        "main",
        [row("a@x.com")],
        logger,
      ),
    ).resolves.toBeDefined()
  })
})
