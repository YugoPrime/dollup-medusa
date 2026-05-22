import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import Busboy from "busboy"
import { uploadInboxAttachmentToR2 } from "../../../../lib/r2-inbox-uploader"

const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
])
const MAX_BYTES = 8 * 1024 * 1024 // Meta's documented inbound cap

type ParsedFile = {
  buffer: Buffer
  mime: string
  filename: string
  threadId: string | null
}

function parseMultipart(req: MedusaRequest): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers as Record<string, string | string[] | undefined>,
      limits: { files: 1, fileSize: MAX_BYTES },
    })
    let file: ParsedFile | null = null
    let threadId: string | null = null
    let rejected = false

    bb.on("field", (name, value) => {
      if (name === "threadId") threadId = value
    })
    bb.on("file", (_name, stream, info) => {
      const mime = (info.mimeType || "").toLowerCase()
      if (!ALLOWED.has(mime)) {
        rejected = true
        stream.resume()
        reject(new Error(`Unsupported mime ${mime}`))
        return
      }
      const chunks: Buffer[] = []
      stream.on("data", (c: Buffer) => chunks.push(c))
      stream.on("limit", () => {
        rejected = true
        reject(new Error(`File exceeds ${MAX_BYTES} bytes`))
      })
      stream.on("end", () => {
        if (rejected) return
        file = {
          buffer: Buffer.concat(chunks),
          mime,
          filename: info.filename || "upload",
          threadId: null,
        }
      })
    })
    bb.on("error", reject)
    bb.on("close", () => {
      if (rejected) return
      if (!file) return reject(new Error("No file in upload"))
      if (!threadId) return reject(new Error("Missing threadId field"))
      file.threadId = threadId
      resolve(file)
    })

    req.pipe(bb)
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!(req as any).auth?.actor_id) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  let parsed: ParsedFile
  try {
    parsed = await parseMultipart(req)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
    return
  }
  try {
    const { url } = await uploadInboxAttachmentToR2(
      parsed.buffer,
      parsed.mime,
      parsed.threadId!,
    )
    res.status(200).json({
      url_r2: url,
      mime: parsed.mime,
      size: parsed.buffer.byteLength,
      filename: parsed.filename,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}
