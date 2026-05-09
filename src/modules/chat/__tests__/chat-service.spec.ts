import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { CHAT_MODULE } from "../index"
import ChatModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<ChatModuleService>({
  moduleName: CHAT_MODULE,
  resolve: "./src/modules/chat",
  testSuite: ({ service }) => {
    describe("ChatModuleService.findOrCreateContact", () => {
      it("creates a new contact on first sighting with link_status=unknown", async () => {
        const c = await service.findOrCreateContact({
          channel: "whatsapp",
          external_id: "+23057123456",
          display_name: "Priya",
        })
        expect(c.id).toMatch(/^ctc_/)
        expect(c.link_status).toBe("unknown")
        expect(c.display_name).toBe("Priya")
        expect(c.last_seen_at).toBeTruthy()
      })

      it("returns the same row on second sighting (idempotent on channel+external_id)", async () => {
        const a = await service.findOrCreateContact({
          channel: "messenger",
          external_id: "psid_alice",
          display_name: "Alice",
        })
        const b = await service.findOrCreateContact({
          channel: "messenger",
          external_id: "psid_alice",
          display_name: "Alice",
        })
        expect(b.id).toBe(a.id)
      })

      it("refreshes display_name when Meta sends a new one", async () => {
        const a = await service.findOrCreateContact({
          channel: "instagram",
          external_id: "igsid_bob",
          display_name: "Bob",
        })
        const b = await service.findOrCreateContact({
          channel: "instagram",
          external_id: "igsid_bob",
          display_name: "Robert",
        })
        expect(b.id).toBe(a.id)
        expect(b.display_name).toBe("Robert")
      })

      it("treats the same external_id across different channels as separate contacts", async () => {
        const wa = await service.findOrCreateContact({
          channel: "whatsapp",
          external_id: "shared_id",
        })
        const ig = await service.findOrCreateContact({
          channel: "instagram",
          external_id: "shared_id",
        })
        expect(ig.id).not.toBe(wa.id)
      })
    })
  },
})
