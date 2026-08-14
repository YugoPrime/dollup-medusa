import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

jest.setTimeout(120 * 1000)

// 32 random bytes, base64url, no padding -> always exactly 43 chars.
// See src/modules/chat/lib/session-id.ts.
const SESSION_ID_RE = /^[A-Za-z0-9_-]{43}$/

medusaIntegrationTestRunner({
  inApp: true,
  env: { STORE_CHAT_ENABLED: "true" },
  testSuite: ({ api, getContainer }) => {
    describe("/store/chat", () => {
      let publishableKey = ""

      // beforeEach, not beforeAll: medusaIntegrationTestRunner truncates the
      // database between tests, which deletes the publishable key along with
      // everything else. Bootstrapped once, only the first test in the file has
      // a valid key — every later request is rejected by the publishable-key
      // middleware with a 400 before reaching the route. That also produced a
      // false pass on "returns 400 for empty text", which got its 400 from the
      // middleware rather than from the validation it claims to test.
      beforeEach(async () => {
        // /store/* is gated by Medusa's framework-level
        // ensurePublishableApiKeyMiddleware (registered globally on the
        // "/store" namespace in @medusajs/framework's ApiLoader): a request
        // with no x-publishable-api-key header, or a revoked/unknown one, is
        // rejected with MedusaError.Types.NOT_ALLOWED -> HTTP 400 before any
        // route handler runs. It is unrelated to the routes' own auth (the
        // 401s below come from the route's session-header check). To get a
        // real key we log in as an admin and create one the same way the
        // dashboard would.
        //
        // The registration token alone is NOT enough for /admin/*: it is minted
        // before any `user` exists, so it carries no actor_id and every admin
        // route answers 401. Two things that look like the fix but are not:
        //   - creating the User row straight off the user module (what
        //     integration-tests/http/sourcing-suppliers.spec.ts does) makes a
        //     user but never links it to the auth identity;
        //   - POST /admin/users needs an authenticated actor itself, so the
        //     registration token cannot bootstrap through it either.
        // The actual link is app_metadata.user_id on the auth identity. Only a
        // token issued AFTER that link carries actor_id, hence the second login.
        const email = "store-chat-spec@dollup.test"
        const password = "supersecret"
        await api.post("/auth/user/emailpass/register", { email, password })

        const userModule: any = getContainer().resolve("user")
        const authModule: any = getContainer().resolve("auth")

        const [user] = await userModule.createUsers([{ email }])
        const identities = await authModule.listAuthIdentities(
          {},
          { relations: ["provider_identities"] },
        )
        const identity = identities.find((i: any) =>
          i.provider_identities?.some((p: any) => p.entity_id === email),
        )
        await authModule.updateAuthIdentities([
          { id: identity.id, app_metadata: { user_id: user.id } },
        ])

        const login = await api.post("/auth/user/emailpass", { email, password })
        const token = login.data.token

        const created = await api.post(
          "/admin/api-keys",
          { title: "store-chat-spec", type: "publishable" },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        publishableKey = created.data.api_key.token
      })

      /** Config for a /store/chat call: publishable key + optional session header, never throws on non-2xx. */
      function storeReq(headers: Record<string, string> = {}) {
        return {
          headers: { "x-publishable-api-key": publishableKey, ...headers },
          validateStatus: () => true,
        }
      }

      function withSession(sessionId: string, headers: Record<string, string> = {}) {
        return storeReq({ "x-dub-chat-session": sessionId, ...headers })
      }

      async function newSession(): Promise<string> {
        const res = await api.post("/store/chat/sessions", {}, storeReq())
        return res.data.session_id
      }

      describe("POST /store/chat/sessions", () => {
        it("returns a session id and ai_active: false", async () => {
          const res = await api.post("/store/chat/sessions", {}, storeReq())

          expect(res.status).toBe(200)
          expect(res.data.session_id).toMatch(SESSION_ID_RE)
          // isAiActive() is a Phase-3 stub that unconditionally returns
          // false (src/modules/ai-agent/lib/is-active.ts) until the
          // ai-agent module exists.
          expect(res.data.ai_active).toBe(false)
        })

        it("returns a different session id on each call", async () => {
          const a = await newSession()
          const b = await newSession()
          expect(a).not.toBe(b)
        })
      })

      describe("POST /store/chat/messages — session header validation", () => {
        it("returns 401 with no session header", async () => {
          const res = await api.post("/store/chat/messages", { text: "hello" }, storeReq())
          expect(res.status).toBe(401)
        })

        it("returns 401 with a malformed session header", async () => {
          const res = await api.post(
            "/store/chat/messages",
            { text: "hello" },
            withSession("nope"),
          )
          expect(res.status).toBe(401)
        })
      })

      describe("POST /store/chat/messages — body validation", () => {
        it("returns 400 for empty or whitespace-only text", async () => {
          const sessionId = await newSession()

          const empty = await api.post("/store/chat/messages", { text: "" }, withSession(sessionId))
          expect(empty.status).toBe(400)

          const whitespace = await api.post(
            "/store/chat/messages",
            { text: "   " },
            withSession(sessionId),
          )
          expect(whitespace.status).toBe(400)
        })

        it("rejects text over 1000 characters and persists nothing", async () => {
          const sessionId = await newSession()
          const tooLong = "a".repeat(1001)

          const postRes = await api.post(
            "/store/chat/messages",
            { text: tooLong },
            withSession(sessionId),
          )
          expect(postRes.status).toBe(400)

          // The rejected request must leave no trace: a session that never
          // had a valid message has no thread, so GET falls through to the
          // { messages: [], ... } default in the route (thread lookup
          // returns null).
          const getRes = await api.get("/store/chat/messages", withSession(sessionId))
          expect(getRes.status).toBe(200)
          expect(getRes.data.messages).toEqual([])
        })
      })

      describe("POST then GET — round trip", () => {
        it("persists the message as inbound/customer with only the public fields", async () => {
          const sessionId = await newSession()
          const text = "Bonjour, avez-vous cette robe en taille M ?"

          const postRes = await api.post(
            "/store/chat/messages",
            { text },
            withSession(sessionId),
          )
          expect(postRes.status).toBe(200)
          expect(typeof postRes.data.message_id).toBe("string")

          const getRes = await api.get("/store/chat/messages", withSession(sessionId))
          expect(getRes.status).toBe(200)
          expect(getRes.data.messages).toHaveLength(1)

          const [msg] = getRes.data.messages
          // ingestInboundWeb() (src/modules/chat/service.ts) always writes
          // customer-authored web messages this way.
          expect(msg.direction).toBe("inbound")
          expect(msg.sender_kind).toBe("customer")
          expect(msg.body).toBe(text)
          expect(msg.id).toBe(postRes.data.message_id)

          // The route hand-maps each row to exactly these five fields
          // (src/api/store/chat/messages/route.ts, PublicMessage). Anything
          // else — draft_reply, meta_error, external_id, sender_user_id —
          // would be a data leak.
          expect(Object.keys(msg).sort()).toEqual(
            ["body", "created_at", "direction", "id", "sender_kind"],
          )
        })
      })

      describe("session isolation", () => {
        it("session B cannot see session A's messages", async () => {
          const sessionA = await newSession()
          const sessionB = await newSession()

          const postRes = await api.post(
            "/store/chat/messages",
            { text: "this belongs to session A only" },
            withSession(sessionA),
          )
          expect(postRes.status).toBe(200)

          const getA = await api.get("/store/chat/messages", withSession(sessionA))
          expect(getA.data.messages).toHaveLength(1)

          const getB = await api.get("/store/chat/messages", withSession(sessionB))
          expect(getB.status).toBe(200)
          expect(getB.data.messages).toEqual([])
        })
      })

      describe("GET /store/chat/messages — polling cursor", () => {
        it("since=<created_at of the last message> returns an empty list", async () => {
          const sessionId = await newSession()
          await api.post(
            "/store/chat/messages",
            { text: "polling cursor test" },
            withSession(sessionId),
          )

          const firstGet = await api.get("/store/chat/messages", withSession(sessionId))
          expect(firstGet.data.messages).toHaveLength(1)
          const lastCreatedAt = firstGet.data.messages[0].created_at

          // The route filters with `created_at > since` (strictly greater),
          // so requesting since the last message's own timestamp must
          // exclude it.
          const sinceGet = await api.get(
            `/store/chat/messages?since=${encodeURIComponent(lastCreatedAt)}`,
            withSession(sessionId),
          )
          expect(sinceGet.status).toBe(200)
          expect(sinceGet.data.messages).toEqual([])
        })
      })

      describe("GET /store/chat/messages — session that never posted", () => {
        it("returns { messages: [], ai_active: false } rather than erroring", async () => {
          const sessionId = await newSession()
          const res = await api.get("/store/chat/messages", withSession(sessionId))

          expect(res.status).toBe(200)
          expect(res.data).toEqual({ messages: [], ai_active: false })
        })
      })
    })
  },
})
