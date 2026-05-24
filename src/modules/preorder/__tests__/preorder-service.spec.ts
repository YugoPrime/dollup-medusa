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
