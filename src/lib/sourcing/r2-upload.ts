import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { randomBytes } from "node:crypto"

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
  })
  return cached
}

export type UploadInput = {
  draftId: string
  filename: string
  contentType: string
  body: Buffer
}

export type UploadResult = { key: string; url: string }

export async function uploadDraftImage(
  input: UploadInput,
): Promise<UploadResult> {
  const bucket = process.env.R2_BUCKET
  const publicBase = process.env.R2_PUBLIC_URL
  if (!bucket || !publicBase) {
    throw new Error("R2 not configured: set R2_BUCKET and R2_PUBLIC_URL")
  }
  const safeName = input.filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
  const random = randomBytes(6).toString("hex")
  const key = `sourcing/${input.draftId}/${random}/${safeName}`
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  return {
    key,
    url: `${publicBase.replace(/\/$/, "")}/${key}`,
  }
}
