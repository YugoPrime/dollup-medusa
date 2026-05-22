import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"

/**
 * Daily R2 sweep for inbox attachment objects. Mirrors the story-renders
 * pattern but with a flat retention rule: anything under `inbox/` older
 * than `retentionDays` is deleted. 90 days is the default — long enough
 * for return windows + most disputes, short enough to keep the bucket tidy.
 *
 * Pure module-level S3 client cache so tests can mock `@aws-sdk/client-s3`
 * once and not pay the construction cost on every call.
 */

let cached: S3Client | null = null

function getClient(): S3Client {
  if (cached) return cached
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 not configured")
  }
  cached = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return cached
}

export type InboxSweepSummary = {
  scanned: number
  deleted: number
  kept: number
  bytes_freed: number
  errors: Array<{ key: string; message: string }>
  dry_run: boolean
}

export async function sweepInboxR2(opts: {
  retentionDays: number
  dryRun: boolean
}): Promise<InboxSweepSummary> {
  const bucket = process.env.R2_BUCKET
  const summary: InboxSweepSummary = {
    scanned: 0,
    deleted: 0,
    kept: 0,
    bytes_freed: 0,
    errors: [],
    dry_run: opts.dryRun,
  }
  if (!bucket) return summary

  const client = getClient()
  const cutoff = Date.now() - opts.retentionDays * 24 * 60 * 60 * 1000
  const stale: Array<{ key: string; size: number }> = []
  let token: string | undefined = undefined

  do {
    const res: {
      Contents?: Array<{ Key?: string; LastModified?: Date; Size?: number }>
      IsTruncated?: boolean
      NextContinuationToken?: string
    } = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "inbox/",
        ContinuationToken: token,
      }),
    )
    for (const item of res.Contents ?? []) {
      if (!item.Key || !item.LastModified) continue
      summary.scanned += 1
      if (item.LastModified.getTime() < cutoff) {
        stale.push({ key: item.Key, size: item.Size ?? 0 })
      } else {
        summary.kept += 1
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)

  summary.deleted = stale.length
  summary.bytes_freed = stale.reduce((s, x) => s + x.size, 0)

  if (opts.dryRun || stale.length === 0) return summary

  for (let i = 0; i < stale.length; i += 1000) {
    const batch = stale.slice(i, i + 1000)
    const res: { Errors?: Array<{ Key?: string; Message?: string }> } =
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((x) => ({ Key: x.key })),
            Quiet: true,
          },
        }),
      )
    for (const e of res.Errors ?? []) {
      summary.errors.push({ key: e.Key ?? "?", message: e.Message ?? "unknown" })
    }
  }
  return summary
}
