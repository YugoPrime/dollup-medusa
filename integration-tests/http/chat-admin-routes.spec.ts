import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: { CHAT_MODULE_ENABLED: "true" },
  testSuite: ({ api, getContainer }) => {
    let token = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "chat-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    describe("GET /admin/chat/threads", () => {
      it("requires authentication", async () => {
        const res = await api.get("/admin/chat/threads", {
          validateStatus: () => true,
        })
        expect(res.status).toBe(401)
      })

      it("returns threads with hydrated contact + last_message, sorted by last_message_at desc", async () => {
        const chat: any = getContainer().resolve("chat")
        await chat.ingestInboundMessenger({
          pageId: "page_1",
          senderId: "psid_first",
          messageId: "mid.first",
          text: "first",
          timestamp: 1730000000000,
          senderProfile: { name: "First" },
        })
        await chat.ingestInboundMessenger({
          pageId: "page_1",
          senderId: "psid_second",
          messageId: "mid.second",
          text: "second",
          timestamp: 1730000001000,
          senderProfile: { name: "Second" },
        })

        const res = await api.get("/admin/chat/threads", auth())
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.threads)).toBe(true)
        expect(res.data.threads.length).toBeGreaterThanOrEqual(2)
        expect(res.data.threads[0].contact).toBeTruthy()
        expect(res.data.threads[0].last_message).toBeTruthy()

        // Sort sanity: the more-recent inbound's contact name must come first.
        const ts = res.data.threads.map((t: any) =>
          t.last_message_at ? new Date(t.last_message_at).getTime() : 0
        )
        const sorted = [...ts].sort((a, b) => b - a)
        expect(ts).toEqual(sorted)
      })

      it("filters by channel + q", async () => {
        const res = await api.get(
          "/admin/chat/threads?channel=messenger&q=first",
          auth()
        )
        expect(res.status).toBe(200)
        const names = res.data.threads.map(
          (t: any) => t.contact?.display_name ?? ""
        )
        expect(names.some((n: string) => n === "First")).toBe(true)
      })
    })

    describe("GET /admin/chat/threads/:id/messages", () => {
      it("returns messages oldest first", async () => {
        const chat: any = getContainer().resolve("chat")
        const out = await chat.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_msgs",
          messageId: "mid.msgs.1",
          text: "first message",
          timestamp: 1730000010000,
          senderProfile: { name: "Msgs" },
        })
        await chat.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_msgs",
          messageId: "mid.msgs.2",
          text: "second message",
          timestamp: 1730000011000,
        })
        const res = await api.get(
          `/admin/chat/threads/${out.thread.id}/messages`,
          auth()
        )
        expect(res.status).toBe(200)
        expect(res.data.messages).toHaveLength(2)
        expect(res.data.messages[0].body).toBe("first message")
        expect(res.data.messages[1].body).toBe("second message")
      })
    })

    describe("POST /admin/chat/threads/:id (mark read)", () => {
      it("zeros unread_count", async () => {
        const chat: any = getContainer().resolve("chat")
        const out = await chat.ingestInboundMessenger({
          pageId: "p1",
          senderId: "psid_unread",
          messageId: "mid.unread.1",
          text: "unread one",
          timestamp: 1730000020000,
        })
        expect(out.thread.unread_count).toBe(1)

        const res = await api.post(
          `/admin/chat/threads/${out.thread.id}`,
          { unread_count: 0 },
          auth()
        )
        expect(res.status).toBe(200)
        expect(res.data.thread.unread_count).toBe(0)
      })
    })
  },
})
