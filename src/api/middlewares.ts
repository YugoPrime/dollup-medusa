import { defineMiddlewares } from "@medusajs/framework/http"
import { raw } from "express"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/meta/*",
      // Disable Medusa's built-in JSON body parser so it doesn't run before
      // our raw() middleware. Without this, Medusa parses the body first and
      // req.body is already a JS object by the time raw() sees it — HMAC would
      // hash a re-serialized string, not the original bytes Meta signed.
      bodyParser: false,
      middlewares: [
        // Parse the body as a raw Buffer up to 10MB. HMAC verification must
        // operate on the exact bytes Meta sent — JSON.parse + re-stringify
        // would change whitespace/key order and break the hash.
        raw({ type: "*/*", limit: "10mb" }),
      ],
    },
    {
      matcher: "/admin/chat/uploads",
      methods: ["POST"],
      // Disable Medusa's JSON body parser so Busboy can read the multipart stream
      // directly. Without this, express.json() consumes the body first and the
      // upload handler hangs because req is already drained.
      bodyParser: false,
    },
    {
      // The bookmarklet route uses its own header-based token auth — skip the
      // admin session middleware so unauthenticated CORS POSTs from shein.com
      // reach the handler.
      matcher: "/admin/preorder/bookmarklet",
      method: ["POST", "OPTIONS"],
      middlewares: [],
    },
  ],
})
