import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { uploadPublicImage } from "../../../../lib/sourcing/r2-upload"
import { bannerFilename, hasImageMagic, sendError } from "../../../../modules/newsletter/route-deps"

const MAX_BYTES = 1.5 * 1024 * 1024
const ALLOWED = new Set(["image/jpeg", "image/png"])
const bad = (m: string) => new MedusaError(MedusaError.Types.INVALID_DATA, m)

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const filename = typeof body.filename === "string" ? body.filename : ""
    const contentType = typeof body.content_type === "string" ? body.content_type : ""
    const base64 = typeof body.base64 === "string" ? body.base64 : ""
    if (!filename || !base64) throw bad("filename and base64 are required")
    if (!ALLOWED.has(contentType)) throw bad("Only JPEG or PNG images are allowed")
    const type = contentType as "image/jpeg" | "image/png"
    const buf = Buffer.from(base64, "base64")
    if (buf.byteLength === 0) throw bad("base64 invalid")
    if (buf.byteLength > MAX_BYTES) throw bad("Image must be 1.5 MB or smaller")
    if (!hasImageMagic(buf, type)) {
      throw bad(`file is not a valid ${type === "image/png" ? "PNG" : "JPEG"}`)
    }
    const out = await uploadPublicImage({
      prefix: "newsletter",
      filename: bannerFilename(filename, type),
      contentType: type,
      body: buf,
    })
    res.json({ url: out.url })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
