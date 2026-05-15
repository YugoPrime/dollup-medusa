import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import fs from "node:fs/promises"

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

export async function uploadStoryRenderToR2(
  localPath: string,
  key: string,
): Promise<string> {
  const bucket = process.env.R2_BUCKET
  const publicBase = process.env.R2_PUBLIC_URL
  if (!bucket || !publicBase) {
    throw new Error("R2 not configured: set R2_BUCKET and R2_PUBLIC_URL")
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: await fs.readFile(localPath),
      ContentType: "video/mp4",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )

  return `${publicBase.replace(/\/$/, "")}/${key}`
}

