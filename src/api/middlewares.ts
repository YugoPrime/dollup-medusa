import { defineMiddlewares } from "@medusajs/framework/http"
import { raw } from "express"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/meta/*",
      middlewares: [
        // Parse the body as a raw Buffer up to 10MB. HMAC verification must
        // operate on the exact bytes Meta sent — JSON.parse + re-stringify
        // would change whitespace/key order and break the hash.
        raw({ type: "*/*", limit: "10mb" }),
      ],
    },
  ],
})
