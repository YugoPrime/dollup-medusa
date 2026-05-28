import { defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { raw } from "express"

// Bookmarklet runs in the user's tab on any shein.com host. Browser sends a
// CORS preflight OPTIONS before the POST. /hooks/* gets no auto-CORS from
// Medusa, so we add the headers manually here.
const ALLOWED_BOOKMARKLET_ORIGINS = new Set([
  "https://shein.com",
  "https://www.shein.com",
  "https://m.shein.com",
  "https://us.shein.com",
  "https://uk.shein.com",
  "https://fr.shein.com",
])

function bookmarkletCors(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
) {
  const origin = req.headers.origin
  if (typeof origin === "string" && ALLOWED_BOOKMARKLET_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Vary", "Origin")
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-preorder-bookmarklet-token",
    )
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Max-Age", "86400")
  }
  if (req.method === "OPTIONS") {
    res.status(204).end()
    return
  }
  next()
}

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
      // Sourcing draft-image upload posts the file as base64 inside a JSON body.
      // Medusa's default JSON body limit is 1MB; an image up to the route's
      // own 2MB cap base64-encodes to ~2.7MB. Without this override the parser
      // rejects the body before the route runs and the default error handler
      // returns "An unknown error occurred." with no usable trace.
      matcher: "/admin/sourcing/uploads",
      methods: ["POST"],
      bodyParser: { sizeLimit: "4mb" },
    },
    {
      // Bookmarklet route lives under /hooks/* because /admin/* and /store/*
      // both have global per-namespace middleware (admin-auth + publishable-
      // key check) registered by Medusa that can't be opted out per-route.
      // /hooks/* has no built-in auth and no built-in CORS — we add CORS
      // manually here and the route handler enforces the token check.
      matcher: "/hooks/preorder-bookmarklet",
      methods: ["POST", "OPTIONS"],
      middlewares: [bookmarkletCors],
    },
  ],
})
