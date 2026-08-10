import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { AI_AGENT_MODULE } from "../index"
import AiAgentModuleService, { AGENT_SETTING_ID } from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<AiAgentModuleService>({
  moduleName: AI_AGENT_MODULE,
  resolve: "./src/modules/ai-agent",
  testSuite: ({ service }) => {
    describe("getSettings", () => {
      it("creates the row with the documented defaults on first call", async () => {
        const settings = await service.getSettings()
        expect(settings.id).toBe(AGENT_SETTING_ID)
        expect(settings.enabled).toBe(false)
        expect(settings.mode).toBe("shadow")
        expect(settings.channels_enabled).toEqual({
          web: true,
          messenger: false,
          instagram: false,
          whatsapp: false,
        })
        expect(settings.monthly_budget_usd_micros).toBe(22_000_000)
        expect(settings.spend_usd_micros).toBe(0)
        expect(settings.budget_alert_sent_at).toBeNull()
        expect(settings.confidence_threshold).toBe(0.7)
        expect(settings.takeover_pause_hours).toBe(12)
      })

      it("is idempotent — a second call returns the same row, not a duplicate", async () => {
        const first = await service.getSettings()
        const second = await service.getSettings()
        expect(second.id).toBe(first.id)

        const all = await service.listAgentSettings({ id: AGENT_SETTING_ID })
        expect(all).toHaveLength(1)
      })
    })

    describe("updateSettings", () => {
      it("persists a patch", async () => {
        await service.getSettings()
        const updated = await service.updateSettings({
          enabled: true,
          mode: "auto",
        })
        expect(updated.enabled).toBe(true)
        expect(updated.mode).toBe("auto")

        const reloaded = await service.getSettings()
        expect(reloaded.enabled).toBe(true)
        expect(reloaded.mode).toBe("auto")
      })
    })

    describe("addSpend", () => {
      it("accumulates across two calls and persists the period", async () => {
        await service.getSettings()
        const first = await service.addSpend(1_000_000)
        expect(first.spend_usd_micros).toBe(1_000_000)
        expect(first.exhausted).toBe(false)

        const second = await service.addSpend(500_000)
        expect(second.spend_usd_micros).toBe(1_500_000)

        const settings = await service.getSettings()
        expect(settings.spend_usd_micros).toBe(1_500_000)
        expect(settings.spend_period).toBe(
          new Date().toISOString().slice(0, 7),
        )
      })
    })
  },
})
