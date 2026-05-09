import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { CHAT_MODULE } from "../index"
import ChatModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<ChatModuleService>({
  moduleName: CHAT_MODULE,
  resolve: "./src/modules/chat",
  testSuite: ({ service }) => {
    describe("ingestInboundMessenger", () => {
      it("creates Contact + Thread + Message on first message and bumps counters", async () => {
        const out = await service.ingestInboundMessenger({
          pageId: "page_1",
          senderId: "psid_alice",
          messageId: "mid.alice.1",
          text: "Hi, do you have IS1361?",
          timestamp: 1730000000000,
          senderProfile: { name: "Alice" },
        })
        expect(out.contact.id).toMatch(/^ctc_/)
        expect(out.contact.channel).toBe("messenger")
        expect(out.contact.display_name).toBe("Alice")
        expect(out.thread.id).toMatch(/^thr_/)
        expect(out.thread.unread_count).toBe(1)
        expect(out.thread.last_inbound_at).toBeTruthy()
        expect(out.thread.last_message_at).toBeTruthy()
        expect(out.message.id).toMatch(/^msg_/)
        expect(out.message.body).toBe("Hi, do you have IS1361?")
        expect(out.message.direction).toBe("inbound")
        expect(out.message.external_id).toBe("mid.alice.1")
        expect(out.message.meta_status).toBe("delivered")
      })

      it("is idempotent on duplicate messageId — returns same row, doesn't double-count", async () => {
        const args = {
          pageId: "p1",
          senderId: "psid_dup",
          messageId: "mid.dup.1",
          text: "hi",
          timestamp: 1730001000000,
        }
        const a = await service.ingestInboundMessenger(args)
        const b = await service.ingestInboundMessenger(args)
        expect(b.message.id).toBe(a.message.id)
        // Counter must NOT increment on the dup
        expect(b.thread.unread_count).toBe(1)
      })

      it("appends to existing thread on second distinct message from same sender", async () => {
        await service.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_chat",
          messageId: "mid.chat.1",
          text: "first",
          timestamp: 1730002000000,
        })
        const second = await service.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_chat",
          messageId: "mid.chat.2",
          text: "second",
          timestamp: 1730003000000,
        })
        expect(second.thread.unread_count).toBe(2)
        const msgs = await service.listMessages({ thread_id: second.thread.id })
        expect(msgs).toHaveLength(2)
      })

      it("stores image attachments as jsonb when present", async () => {
        const out = await service.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_img",
          messageId: "mid.img.1",
          text: null,
          attachments: [{ type: "image", url: "https://meta.example/img.jpg" }],
          timestamp: 1730004000000,
        })
        expect(out.message.body).toBeNull()
        expect(Array.isArray(out.message.attachments)).toBe(true)
        expect(out.message.attachments[0].url).toBe("https://meta.example/img.jpg")
      })

      it("stores empty attachments array as null (cleanliness)", async () => {
        const out = await service.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_clean",
          messageId: "mid.clean.1",
          text: "no attachments",
          attachments: [],
          timestamp: 1730005000000,
        })
        expect(out.message.attachments).toBeNull()
      })
    })
  },
})
