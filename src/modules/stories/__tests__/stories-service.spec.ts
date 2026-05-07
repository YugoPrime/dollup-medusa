import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { STORIES_MODULE } from "../index"
import StoriesModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<StoriesModuleService>({
  moduleName: STORIES_MODULE,
  resolve: "./src/modules/stories",
  testSuite: ({ service }) => {
    describe("StoriesModuleService — settings", () => {
      it("getSettings returns defaults on first call", async () => {
        const s = await service.getSettings()
        expect(s.anti_repeat_days).toBe(7)
        expect(s.caption_template).toContain("{name}")
        expect(s.default_distribution).toEqual([])
        expect(s.default_schedule).toEqual([])
      })

      it("getSettings is idempotent", async () => {
        const a = await service.getSettings()
        const b = await service.getSettings()
        expect(a.id).toBe(b.id)
      })

      it("updateSettings merges partial input", async () => {
        await service.getSettings()
        const updated = await service.updateSettings({ anti_repeat_days: 14 })
        expect(updated.anti_repeat_days).toBe(14)
        expect(updated.caption_template).toContain("{name}")
      })
    })
  },
})
