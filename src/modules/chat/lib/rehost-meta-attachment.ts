import { uploadInboxAttachmentToR2 } from "../../../lib/r2-inbox-uploader"

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
])

export type RehostedAttachment = {
  kind: "image"
  url_r2: string
  mime: string
  size: number
}

/**
 * Downloads a Meta-hosted attachment and re-hosts it on R2.
 *
 * Meta attachment URLs expire (CDN-signed, lifetime measured in hours). If we
 * don't capture the bytes during webhook processing, staff opening the thread
 * later see a broken thumbnail. We treat any failure (network, non-image, bad
 * mime) as "drop the attachment but keep the message" — the message body still
 * lands and the operator sees the text. Returning null is the contract.
 *
 * v1 = images only. Video / audio / documents are scoped out; we'll layer in
 * Phase 5.1 by relaxing the kind filter + adding more mime checks.
 */
export async function rehostMetaAttachment(
  attachment: { type: string; url?: string | null },
  threadId: string,
): Promise<RehostedAttachment | null> {
  if (attachment.type !== "image") return null
  if (!attachment.url) return null

  let resp: Response
  try {
    resp = await fetch(attachment.url)
  } catch {
    return null
  }
  if (!resp.ok) return null

  const ct = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
  if (!ALLOWED_IMAGE_MIME.has(ct)) return null

  const ab = await resp.arrayBuffer()
  const body = Buffer.from(ab)
  if (body.byteLength === 0) return null

  try {
    const { url } = await uploadInboxAttachmentToR2(body, ct, threadId)
    return { kind: "image", url_r2: url, mime: ct, size: body.byteLength }
  } catch {
    return null
  }
}
