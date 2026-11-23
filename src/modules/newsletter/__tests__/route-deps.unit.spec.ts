import { MedusaError } from "@medusajs/framework/utils"

import {
  buildCampaignDeps,
  bannerFilename,
  errorBody,
  hasImageMagic,
  httpStatusFor,
  parseIdsParam,
  pickerRowsInOrder,
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
    expect(typeof logger.error.mock.calls[0][0]).toBe("string")
    expect(logger.error.mock.calls[0][0]).toContain("You have reached your contacts quota.")
    expect(logger.error.mock.calls[0]).toHaveLength(1)

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
  // Fake subscriber table: syncImportedRows re-reads every row before pushing it.
  let db: Map<string, SubscriberDTO>
  beforeEach(() => {
    db = new Map()
  })
  const row = (email: string, unsub = false) => {
    const r = { id: "id_" + email, email, status: unsub ? "unsubscribed" : "subscribed" } as SubscriberDTO
    db.set(r.id, r)
    return r
  }
  const setStatus = (r: SubscriberDTO, status: SubscriberDTO["status"]) => db.set(r.id, { ...r, status })
  const retrieve = () =>
    jest.fn(async (id: string) => {
      const r = db.get(id)
      if (!r) {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, `NewsletterSubscriber with id: ${id} was not found`)
      }
      return { ...r }
    })
  const mk = () => {
    const service = { markSynced: jest.fn(), markSyncError: jest.fn(), retrieveNewsletterSubscriber: retrieve() }
    const logger = { info: jest.fn(), error: jest.fn() }
    return { service, logger }
  }

  it("uses the row's CURRENT status: flipped to unsubscribed mid-sync → setUnsubscribed, no ensureContact", async () => {
    const { service, logger } = mk()
    const a = row("a@x.com")
    const b = row("b@x.com")
    const resend = {
      ensureContact: jest.fn(async () => {
        setStatus(b, "unsubscribed") // b unsubscribes while a is being synced
        return { ok: true, contactId: "c1" }
      }),
      setUnsubscribed: jest.fn().mockResolvedValue(undefined),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [a, b],
      logger,
    )
    expect(resend.ensureContact).toHaveBeenCalledTimes(1)
    expect(resend.ensureContact).toHaveBeenCalledWith("a@x.com", "seg", false)
    expect(resend.setUnsubscribed).toHaveBeenCalledTimes(1)
    expect(resend.setUnsubscribed).toHaveBeenCalledWith("b@x.com")
    expect(service.markSynced).toHaveBeenCalledWith("id_b@x.com", null)
    expect(service.retrieveNewsletterSubscriber).toHaveBeenCalledWith("id_b@x.com")
    expect(out).toEqual({ synced: 2, failed: 0 })
  })

  it("a row passed as unsubscribed but re-added since gets ensureContact(false), not setUnsubscribed", async () => {
    const { service, logger } = mk()
    const u = row("u@x.com", true)
    setStatus(u, "subscribed")
    const resend = {
      ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c9" }),
      setUnsubscribed: jest.fn(),
    }
    await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [u],
      logger,
    )
    expect(resend.setUnsubscribed).not.toHaveBeenCalled()
    expect(resend.ensureContact).toHaveBeenCalledWith("u@x.com", "seg", false)
  })

  it("skips rows that no longer exist without touching Resend or recording an error", async () => {
    const { service, logger } = mk()
    const gone = row("gone@x.com")
    const kept = row("kept@x.com")
    db.delete(gone.id)
    const resend = {
      ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c1" }),
      setUnsubscribed: jest.fn(),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [gone, kept],
      logger,
    )
    expect(resend.ensureContact).toHaveBeenCalledTimes(1)
    expect(resend.ensureContact).toHaveBeenCalledWith("kept@x.com", "seg", false)
    expect(service.markSyncError).not.toHaveBeenCalled()
    expect(out).toEqual({ synced: 1, failed: 0 })
  })

  it("a failing re-read is recorded and nothing is pushed for that row", async () => {
    const { service, logger } = mk()
    const a = row("a@x.com")
    service.retrieveNewsletterSubscriber.mockRejectedValueOnce(new Error("db down"))
    const resend = { ensureContact: jest.fn(), setUnsubscribed: jest.fn() }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [a],
      logger,
    )
    expect(resend.ensureContact).not.toHaveBeenCalled()
    expect(resend.setUnsubscribed).not.toHaveBeenCalled()
    expect(service.markSyncError).toHaveBeenCalledWith("id_a@x.com", "db down")
    expect(out).toEqual({ synced: 0, failed: 1 })
  })

  it("pushes subscribed rows with ensureContact(false) and marks synced", async () => {
    const { service, logger } = mk()
    const resend = {
      ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c1" }),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [row("a@x.com"), row("b@x.com")],
      logger,
    )
    expect(resend.ensureContact).toHaveBeenNthCalledWith(1, "a@x.com", "seg", false)
    expect(resend.ensureContact).toHaveBeenNthCalledWith(2, "b@x.com", "seg", false)
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
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
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

  it("unsubscribed rows only get setUnsubscribed, never ensureContact", async () => {
    const { service, logger } = mk()
    const resend = {
      ensureContact: jest.fn(),
      setUnsubscribed: jest.fn().mockResolvedValue(undefined),
    }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [row("new@x.com", true), row("flipped@x.com", true)],
      logger,
    )
    expect(resend.setUnsubscribed).toHaveBeenCalledWith("new@x.com")
    expect(resend.setUnsubscribed).toHaveBeenCalledWith("flipped@x.com")
    expect(resend.ensureContact).not.toHaveBeenCalled()
    expect(service.markSynced).toHaveBeenCalledWith("id_new@x.com", null)
    expect(out).toEqual({ synced: 2, failed: 0 })
  })

  it("records a throwing setUnsubscribed", async () => {
    const { service, logger } = mk()
    const resend = { setUnsubscribed: jest.fn().mockRejectedValue(new Error("403")) }
    const out = await syncImportedRows(
      { service, getResend: () => ({ resend: resend as any, segmentId: () => "seg" }) },
      "main",
      [row("a@x.com", true)],
      logger,
    )
    expect(service.markSyncError).toHaveBeenCalledWith("id_a@x.com", "403")
    expect(out).toEqual({ synced: 0, failed: 1 })
  })

  it("a missing segment fails subscribed rows but still unsubscribes the others", async () => {
    const { service, logger } = mk()
    const resend = {
      ensureContact: jest.fn(),
      setUnsubscribed: jest.fn().mockResolvedValue(undefined),
    }
    const out = await syncImportedRows(
      {
        service,
        getResend: () => ({
          resend: resend as any,
          segmentId: () => {
            throw new Error("segment unset")
          },
        }),
      },
      "main",
      [row("a@x.com"), row("u@x.com", true)],
      logger,
    )
    expect(service.markSyncError).toHaveBeenCalledWith("id_a@x.com", "segment unset")
    expect(resend.setUnsubscribed).toHaveBeenCalledWith("u@x.com")
    expect(resend.ensureContact).not.toHaveBeenCalled()
    expect(out).toEqual({ synced: 1, failed: 1 })
  })

  it("never throws even when markSynced itself fails", async () => {
    const { logger } = mk()
    const service = {
      markSynced: jest.fn().mockRejectedValue(new Error("db down")),
      markSyncError: jest.fn().mockRejectedValue(new Error("db down")),
      retrieveNewsletterSubscriber: retrieve(),
    }
    const resend = { ensureContact: jest.fn().mockResolvedValue({ ok: true, contactId: "c" }) }
    await expect(
      syncImportedRows(
        { service, getResend: () => ({ resend: resend as any, segmentId: () => "s" }) },
        "main",
        [row("a@x.com")],
        logger,
      ),
    ).resolves.toBeDefined()
  })
})

describe("bannerFilename", () => {
  it("forces the extension from the content type", () => {
    expect(bannerFilename("Spring Sale.WEBP", "image/jpeg")).toBe("spring_sale.jpg")
    expect(bannerFilename("hero.jpeg", "image/png")).toBe("hero.png")
    expect(bannerFilename("a.b.c", "image/jpeg")).toBe("a.b.jpg")
  })
  it("falls back to banner for empty or dot-only names", () => {
    expect(bannerFilename("blob", "image/jpeg")).toBe("blob.jpg")
    expect(bannerFilename("..", "image/jpeg")).toBe("banner.jpg")
    expect(bannerFilename(".png", "image/png")).toBe("banner.png")
    expect(bannerFilename("../../x", "image/png")).toBe("x.png")
  })
})

describe("hasImageMagic", () => {
  it("checks JPEG and PNG signatures", () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])
    expect(hasImageMagic(jpg, "image/jpeg")).toBe(true)
    expect(hasImageMagic(png, "image/png")).toBe(true)
    expect(hasImageMagic(png, "image/jpeg")).toBe(false)
    expect(hasImageMagic(jpg, "image/png")).toBe(false)
    expect(hasImageMagic(Buffer.from([0xff, 0xd8]), "image/jpeg")).toBe(false)
    expect(hasImageMagic(Buffer.from("<html>"), "image/jpeg")).toBe(false)
  })
})

describe("parseIdsParam / pickerRowsInOrder", () => {
  it("trims and de-duplicates", () => {
    expect(parseIdsParam(" a, b ,a,,c")).toEqual(["a", "b", "c"])
  })
  it("rejects more than 24 ids with INVALID_DATA", () => {
    const many = Array.from({ length: 25 }, (_, i) => "p" + i).join(",")
    expect(() => parseIdsParam(many)).toThrow(/at most 24/)
    expect(httpStatusFor(safe(() => parseIdsParam(many)))).toBe(400)
  })
  it("returns rows in the requested order, omits missing, keeps adult/unlisted", () => {
    const mkp = (id: string, extra: object = {}) =>
      ({
        id,
        title: id,
        handle: id,
        status: "published",
        thumbnail: null,
        images: [],
        categories: [{ handle: "toys" }],
        metadata: { unlisted: true },
        variants: [],
        ...extra,
      }) as any
    const rows = pickerRowsInOrder(["b", "x", "a"], [mkp("a"), mkp("b")])
    expect(rows.map((r) => r.id)).toEqual(["b", "a"])
    expect(rows[0].adult).toBe(true)
  })
})

function safe(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  return undefined
}
