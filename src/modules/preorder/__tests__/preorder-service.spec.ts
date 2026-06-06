import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { PREORDER_MODULE } from "../index"
import PreorderModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<PreorderModuleService>({
  moduleName: PREORDER_MODULE,
  resolve: "./src/modules/preorder",
  testSuite: ({ service }) => {
    describe("PreorderModuleService", () => {
      describe("getSettings", () => {
        it("returns defaults on first read", async () => {
          const settings = await service.getSettings()
          expect(settings.fx_rate_usd_to_mur).toBe(50)
          expect(settings.customs_percent).toBe(25)
          expect(settings.deposit_percent).toBe(75)
          expect(settings.eta_min_days).toBe(15)
          expect(settings.eta_max_days).toBe(20)
        })

        it("is idempotent — second call returns same row", async () => {
          const a = await service.getSettings()
          const b = await service.getSettings()
          expect(b.id).toEqual(a.id)
        })
      })

      describe("updateSettings", () => {
        it("updates fx_rate and leaves other fields unchanged", async () => {
          const before = await service.getSettings()
          const after = await service.updateSettings({ fx_rate_usd_to_mur: 55 })
          expect(after.fx_rate_usd_to_mur).toBe(55)
          expect(after.deposit_percent).toBe(before.deposit_percent)
        })

        it("rejects negative fx_rate", async () => {
          await expect(
            service.updateSettings({ fx_rate_usd_to_mur: -1 }),
          ).rejects.toThrow()
        })

        it("rejects deposit_percent over 100", async () => {
          await expect(
            service.updateSettings({ deposit_percent: 150 }),
          ).rejects.toThrow()
        })

        it("rejects eta_min_days > eta_max_days", async () => {
          await expect(
            service.updateSettings({ eta_min_days: 30, eta_max_days: 20 }),
          ).rejects.toThrow()
        })
      })

      describe("recomputeRequestStatus", () => {
        it("does NOT change status when request is already 'expired'", async () => {
          const svc = service as any
          const request = await svc.createPreorderQuoteRequests({
            contact: { whatsapp: "+23050000000" },
            items_count: 1,
            status: "expired",
          })
          // A late daemon result lands a quoted item on an already-expired request.
          await svc.createPreorderQuoteItems([
            {
              request_id: request.id,
              position: 0,
              shein_url: "https://shein.com/p/1",
              status: "quoted",
            },
          ])

          await service.recomputeRequestStatus(request.id)

          const [after] = await svc.listPreorderQuoteRequests({ id: request.id })
          expect(after.status).toBe("expired")
        })
      })

      describe("claimQuoteJob", () => {
        it("returns false and does not update when item.status is 'quoted'", async () => {
          const svc = service as any
          const request = await svc.createPreorderQuoteRequests({
            contact: { whatsapp: "+23050000001" },
            items_count: 1,
            status: "quoted",
          })
          const [item] = await svc.createPreorderQuoteItems([
            {
              request_id: request.id,
              position: 0,
              shein_url: "https://shein.com/p/2",
              status: "quoted",
              attempts: 0,
            },
          ])

          const claimed = await service.claimQuoteJob(item.id)

          expect(claimed).toBe(false)
          const [after] = await svc.listPreorderQuoteItems({ id: item.id })
          expect(after.status).toBe("quoted")
          expect(Number(after.attempts ?? 0)).toBe(0)
        })
      })

      describe("previewPrice", () => {
        it("uses current settings to compute price", async () => {
          await service.updateSettings({
            fx_rate_usd_to_mur: 50,
            customs_percent: 25,
          })
          const result = await service.previewPrice({ sheinPriceUsd: 4 })
          expect(result.finalPriceMur).toBe(400)
        })

        it("reflects updated fx_rate immediately", async () => {
          await service.updateSettings({ fx_rate_usd_to_mur: 60 })
          const result = await service.previewPrice({ sheinPriceUsd: 4 })
          expect(result.finalPriceMur).toBe(450)
        })
      })
    })
  },
})
