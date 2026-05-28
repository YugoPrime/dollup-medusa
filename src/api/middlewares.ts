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
      // The bookmarklet route uses its own header-based token auth — skip
      // Medusa's built-in middlewares so cross-origin POSTs from shein.com
      // reach the handler. Lives under /store/* (not /admin/*) because the
      // admin-auth middleware is global and can't be disabled per-route.
      // authenticate: false also skips the publishable-key check that
      // normally guards /store/* routes.
      matcher: "/store/preorder/bookmarklet",
      methods: ["POST", "OPTIONS"],
      authenticate: false,
      middlewares: [],
    },
  ],
})
