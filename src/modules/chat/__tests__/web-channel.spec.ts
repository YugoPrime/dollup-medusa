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

      it("reopens a closed thread on a new inbound message", async () => {
        // Mirrors what chat-web-session-cleanup.ts does to an idle thread —
        // closing it — then proves a returning visitor's next message pulls
        // it back into /inbox's default status:"open" filter instead of
        // silently landing in a closed, invisible thread.
        const sessionId = newSessionId()
        const first = await service.ingestInboundWeb({ sessionId, text: "un" })
        await service.updateThreads({
          id: first.thread.id,
          status: "closed",
        } as never)

        const second = await service.ingestInboundWeb({ sessionId, text: "deux" })
        expect(second.thread.id).toBe(first.thread.id)
        expect(second.thread.status).toBe("open")
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

      it("rejects (not orphans) when the thread's contact is deleted", async () => {
        // This test was written asserting /no contact/ — the guard at
        // service.ts:208 — and had never been executed. Running it shows that
        // guard is unreachable through this module's own API:
        //   - deleteContacts is a HARD delete; chat_thread.contact is a real FK
        //     and Postgres refuses it outright.
        //   - softDeleteContacts CASCADES to the thread (and its messages), so
        //     listThreads misses too and the "No thread" guard fires first.
        //   - restoreThreads will not bring the thread back on its own while its
        //     contact row stays soft-deleted.
        // So "live thread, missing contact" cannot be constructed here, and the
        // contact guard is defensive-only. Keep it — it is free — but assert what
        // is actually reachable: deleting the contact makes the thread unsendable,
        // and nothing is left behind in a pending state for a sender to retry.
        const { thread, contact } = await service.ingestInboundWeb({
          sessionId: newSessionId(),
          text: "hi",
        })
        await service.softDeleteContacts([contact.id])

        await expect(
          service.sendOutbound({
            threadId: thread.id,
            body: "should never send",
            senderKind: "ai",
          }),
        ).rejects.toThrow(/no thread|no contact/i)

        // And critically: no orphaned pending row was left behind — the guard
        // fires before createMessages, so nothing was written for this send.
        const messages = await service.listMessages(
          { thread_id: thread.id },
          { withDeleted: true },
        )
        expect(messages.every((m) => m.meta_status !== "pending")).toBe(true)
      })
    })
  },
})
