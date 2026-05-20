import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
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

export type R2StoryObject = {
  key: string
  lastModified: Date
  size: number
}

/**
 * Lists every story MP4 in the configured R2 bucket under the `stories/` prefix.
 * Paginates via `ContinuationToken` so 1000+ objects don't get silently
 * truncated. Returns an empty array when R2 isn't configured.
 */
export async function listStoryRenders(): Promise<R2StoryObject[]> {
  const bucket = process.env.R2_BUCKET
  if (!bucket) return []
  const client = getClient()
  const out: R2StoryObject[] = []
  let continuationToken: string | undefined = undefined
  do {
    const res: { Contents?: Array<{ Key?: string; LastModified?: Date; Size?: number }>; IsTruncated?: boolean; NextContinuationToken?: string } = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "stories/",
        ContinuationToken: continuationToken,
      }),
    )
    for (const item of res.Contents ?? []) {
      if (!item.Key || !item.LastModified) continue
      out.push({
        key: item.Key,
        lastModified: item.LastModified,
        size: item.Size ?? 0,
      })
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (continuationToken)
  return out
}

/**
 * Deletes the given keys from R2 in batches of 1000 (S3 DeleteObjects max).
 * Returns the count of successfully-requested deletions; per-key failures are
 * returned via S3's response.Errors which we surface but don't throw on.
 */
export async function deleteStoryRenders(
  keys: string[],
): Promise<{ deleted: number; errors: Array<{ key: string; message: string }> }> {
  if (keys.length === 0) return { deleted: 0, errors: [] }
  const bucket = process.env.R2_BUCKET
  if (!bucket) {
    throw new Error("R2 not configured: set R2_BUCKET")
  }
  const client = getClient()
  const errors: Array<{ key: string; message: string }> = []
  let deleted = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    )
    deleted += batch.length - (res.Errors?.length ?? 0)
    for (const e of res.Errors ?? []) {
      errors.push({ key: e.Key ?? "?", message: e.Message ?? "unknown" })
    }
  }
  return { deleted, errors }
}

/**
 * Parses an R2 key like `stories/stslot_01ABC.../<hash>.mp4` and returns the
 * slot id segment. Returns null for keys that don't fit the schema.
 */
export function parseSlotIdFromKey(key: string): string | null {
  const m = /^stories\/(stslot_[A-Z0-9]+)\/[a-f0-9]+\.mp4$/i.exec(key)
  return m ? m[1] : null
}

