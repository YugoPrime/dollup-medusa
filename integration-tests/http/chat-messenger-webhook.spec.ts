import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import crypto from "crypto"

jest.setTimeout(60 * 1000)

const SECRET = "integration-test-secret"

medusaIntegrationTestRunner({
  inApp: true,
  env: {
    META_APP_SECRET: SECRET,
    META_MESSENGER_VERIFY_TOKEN: "verify-me",
    CHAT_MODULE_ENABLED: "true",
  },
  testSuite: ({ api, getContainer }) => {
    function sign(body: string) {
      return (
        "sha256=" +
        crypto.createHmac("sha256", SECRET).update(body).digest("hex")
      )
    }

    describe("GET /hooks/meta/messenger (verification handshake)", () => {
      it("echoes the challenge when token matches", async () => {
        const res = await api.get(
          "/hooks/meta/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"
        )
        expect(res.status).toBe(200)
        expect(res.data).toBe("42")
      })

      it("rejects with 403 on token mismatch", async () => {
        const res = await api.get(
          "/hooks/meta/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42",
          { validateStatus: () => true }
        )
        expect(res.status).toBe(403)
      })
    })

    describe("POST /hooks/meta/messenger", () => {
      it("rejects bad HMAC with 401", async () => {
        const res = await api.post(
          "/hooks/meta/messenger",
          { object: "page", entry: [] },
          {
            headers: {
              "x-hub-signature-256": "sha256=deadbeef",
              "content-type": "application/json",
            },
            validateStatus: () => true,
          }
        )
        expect(res.status).toBe(401)
      })

      it("ingests a text message and responds 200", async () => {
        const body = JSON.stringify({
          object: "page",
          entry: [
            {
              id: "page_test",
              messaging: [
                {
                  sender: { id: "psid_alice" },
                  recipient: { id: "page_test" },
                  timestamp: Date.now(),
                  message: { mid: "mid.smoke.1", text: "hello inbox" },
                },
              ],
            },
          ],
        })
        const res = await api.post("/hooks/meta/messenger", body, {
          headers: {
            "x-hub-signature-256": sign(body),
            "content-type": "application/json",
          },
          transformRequest: [(d) => d], // axios will otherwise re-serialize
          validateStatus: () => true,
        })
        expect(res.status).toBe(200)

        const chat: any = getContainer().resolve("chat")
        const [msg] = await chat.listMessages({ external_id: "mid.smoke.1" })
        expect(msg.body).toBe("hello inbox")
      })

      it("returns 200 'disabled' when feature flag is off", async () => {
        const prev = process.env.CHAT_MODULE_ENABLED
        process.env.CHAT_MODULE_ENABLED = "false"
        try {
          const body = JSON.stringify({ object: "page", entry: [] })
          const res = await api.post("/hooks/meta/messenger", body, {
            headers: {
              "x-hub-signature-256": sign(body),
              "content-type": "application/json",
            },
            transformRequest: [(d) => d],
          })
          expect(res.status).toBe(200)
          expect(res.data).toBe("disabled")
        } finally {
          process.env.CHAT_MODULE_ENABLED = prev
        }
      })
    })
  },
})
