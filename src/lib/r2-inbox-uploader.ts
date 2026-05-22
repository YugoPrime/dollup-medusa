import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { createHash } from "node:crypto"

let cached: S3Client | null = null

function getClient(): S3Client {
  if (cached) return cached
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY",
    )
  }
  cached = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return cached
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

export function buildInboxKey(
  threadId: string,
  mime: string,
  body: Buffer,
): string {
  const ext = EXT_BY_MIME[mime.toLowerCase()] ?? "bin"
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 32)
  return `inbox/${threadId}/${hash}.${ext}`
}

export async function uploadInboxAttachmentToR2(
  body: Buffer,
  mime: string,
  threadId: string,
): Promise<{ url: string; key: string }> {
  const bucket = process.env.R2_BUCKET
  const publicBase = process.env.R2_PUBLIC_URL
  if (!bucket || !publicBase) {
    throw new Error("R2 not configured: set R2_BUCKET and R2_PUBLIC_URL")
  }
  const key = buildInboxKey(threadId, mime, body)
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  return {
    url: `${publicBase.replace(/\/$/, "")}/${key}`,
    key,
  }
}
