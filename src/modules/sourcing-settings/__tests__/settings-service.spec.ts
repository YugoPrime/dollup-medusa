import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_SETTINGS_MODULE } from "../index"
import type SourcingSettingsService from "../service"

jest.setTimeout(60_000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("SourcingSettingsService", () => {
      let service: SourcingSettingsService

      beforeEach(() => {
        service = getContainer().resolve(SOURCING_SETTINGS_MODULE)
      })

      it("returns defaults on first read (singleton auto-created)", async () => {
        const s = await service.getSettings()
        expect(s.id).toBe("default")
        expect(s.fx_rate).toBe(46)
        expect(s.landed_multiplier_default).toBe(1.5)
        expect(s.markup_multiplier).toBe(2.5)
        expect(s.round_step).toBe(50)
      })

      it("persists updates", async () => {
        await service.updateSettings({ fx_rate: 47.5, round_step: 100 })
        const s = await service.getSettings()
        expect(s.fx_rate).toBe(47.5)
        expect(s.round_step).toBe(100)
        expect(s.markup_multiplier).toBe(2.5) // unchanged
      })

      it("rejects non-positive values", async () => {
        await expect(service.updateSettings({ fx_rate: 0 })).rejects.toThrow()
        await expect(
          service.updateSettings({ markup_multiplier: -1 }),
        ).rejects.toThrow()
      })

      it("rejects non-integer round_step", async () => {
        await expect(
          service.updateSettings({ round_step: 2.5 }),
        ).rejects.toThrow()
      })
    })
  },
})
