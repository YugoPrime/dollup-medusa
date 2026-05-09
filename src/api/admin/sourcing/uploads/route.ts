import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { uploadDraftImage } from "../../../../lib/sourcing/r2-upload"

function logError(
  req: AuthenticatedMedusaRequest,
  context: string,
  err: Error,
): void {
  try {
    const logger = req.scope.resolve<{
      error: (msg: string, meta?: unknown) => void
    }>("logger")
    logger.error(`${context}: ${err.message}`, { stack: err.stack })
  } catch {
    // best-effort
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const draftId = String(body.draft_id ?? "")
    const filename = String(body.filename ?? "")
    const contentType = String(body.content_type ?? "application/octet-stream")
    const base64 = String(body.base64 ?? "")
    if (!draftId || !filename || !base64) {
      return res
        .status(400)
        .json({ message: "draft_id, filename, base64 are required" })
    }
    let buf: Buffer
    try {
      buf = Buffer.from(base64, "base64")
    } catch {
      return res.status(400).json({ message: "base64 invalid" })
    }
    const MAX = 2 * 1024 * 1024
    if (buf.byteLength > MAX) {
      return res.status(400).json({ message: "Image must be ≤ 2MB" })
    }
    const out = await uploadDraftImage({
      draftId,
      filename,
      contentType,
      body: buf,
    })
    res.json(out)
  } catch (err) {
    const e = err as Error
    logError(req, "POST /admin/sourcing/uploads", e)
    res.status(400).json({ message: e.message ?? "Upload failed" })
  }
}
