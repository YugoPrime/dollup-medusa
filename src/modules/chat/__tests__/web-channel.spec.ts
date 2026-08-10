import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { CHAT_MODULE } from "../index"
import ChatModuleService from "../service"
import { newSessionId } from "../lib/session-id"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<ChatModuleService>({
  moduleName: CHAT_MODULE,
  resolve: "./src/modules/chat",
  testSuite: ({ service }) => {
    describe("ingestInboundWeb", () => {
      it("creates contact + thread + message on first message", async () => {
        const sessionId = newSessionId()
        const out = await service.ingestInboundWeb({ sessionId, text: "bonjour" })
        expect(out.contact.channel).toBe("web")
        expect(out.contact.external_id).toBe(sessionId)
        expect(out.thread.channel).toBe("web")
        expect(out.thread.unread_count).toBe(1)
        expect(out.thread.needs_human).toBe(false)
        expect(out.message.body).toBe("bonjour")
        expect(out.message.direction).toBe("inbound")
        expect(out.message.sender_kind).toBe("customer")
      })

      it("reuses the same thread for the same session", async () => {
        const sessionId = newSessionId()
        const first = await service.ingestInboundWeb({ sessionId, text: "un" })
        const second = await service.ingestInboundWeb({ sessionId, text: "deux" })
        expect(second.thread.id).toBe(first.thread.id)
        expect(second.thread.unread_count).toBe(2)
      })

      it("keeps separate sessions in separate threads", async () => {
        const a = await service.ingestInboundWeb({ sessionId: newSessionId(), text: "a" })
        const b = await service.ingestInboundWeb({ sessionId: newSessionId(), text: "b" })
        expect(b.thread.id).not.toBe(a.thread.id)
      })
    })

    describe("sendOutbound on web", () => {
      it("persists an ai message and marks it sent", async () => {
        const { thread } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        const out = await service.sendOutbound({
          threadId: thread.id,
          body: "Bonjour ! Comment puis-je aider ?",
          senderKind: "ai",
        })
        expect(out.message.sender_kind).toBe("ai")
        expect(out.message.direction).toBe("outbound")
        expect(out.message.meta_status).toBe("sent")
      })

      it("a staff reply pauses the agent on that thread", async () => {
        const { thread } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        const out = await service.sendOutbound({
          threadId: thread.id,
          body: "I'll take this one",
          senderKind: "staff",
          senderUserId: "user_1",
        })
        expect(out.thread.ai_paused_until).toBeTruthy()
        expect(new Date(out.thread.ai_paused_until).getTime()).toBeGreaterThan(Date.now())
      })

      it("an ai reply does NOT pause the agent", async () => {
        const { thread } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        const out = await service.sendOutbound({
          threadId: thread.id,
          body: "…",
          senderKind: "ai",
        })
        expect(out.thread.ai_paused_until).toBeNull()
      })

      it("rejects an empty body", async () => {
        const { thread } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        await expect(
          service.sendOutbound({ threadId: thread.id, body: "   ", senderKind: "ai" }),
        ).rejects.toThrow(/empty/i)
      })

      it("web never hits the outside-window guard", async () => {
        const { thread } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        await service.updateThreads({
          id: thread.id,
          last_inbound_at: new Date(Date.now() - 90 * 24 * 3600_000),
        } as never)
        const out = await service.sendOutbound({
          threadId: thread.id,
          body: "toujours possible",
          senderKind: "ai",
        })
        expect(out.message.meta_status).toBe("sent")
      })
    })
  },
})
