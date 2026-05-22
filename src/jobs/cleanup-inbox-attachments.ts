import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { sweepInboxR2 } from "../lib/cleanup-stale-inbox-attachments"
import { sendTelegram } from "../lib/telegram"

/**
 * Daily R2 housekeeping for inbox attachments. Mirrors
 * cleanup-story-renders.ts but with INBOX_R2_CLEANUP_* env vars and an
 * `inbox/` prefix. Default retention is 90 days — long enough for return
 * windows + most disputes, short enough to keep R2 tidy.
 *
 * Cron: 04:00 Mauritius time daily, offset from the 03:30 stories sweep.
 */
export default async function cleanupInboxAttachments(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  if (process.env.INBOX_R2_CLEANUP_ENABLED !== "true") {
    logger.info("[cleanup-inbox-attachments] disabled, skipping")
    return
  }
  const retentionDays = Number(process.env.INBOX_R2_CLEANUP_DAYS || "90")
  const dryRun = process.env.INBOX_R2_CLEANUP_DRY_RUN === "true"

  const summary = await sweepInboxR2({ retentionDays, dryRun })
  const mb = (summary.bytes_freed / (1024 * 1024)).toFixed(1)
  const prefix = summary.dry_run ? "DRY-RUN " : ""
  logger.info(
    `[cleanup-inbox-attachments] ${prefix}scanned=${summary.scanned} ` +
      `deleted=${summary.deleted} kept=${summary.kept} ` +
      `freed=${mb}MB errors=${summary.errors.length}`,
  )

  if (
    summary.deleted > 0 ||
    summary.errors.length > 0 ||
    (summary.dry_run && summary.bytes_freed > 0)
  ) {
    const text =
      `${summary.dry_run ? "🔍 <b>Inbox R2 (dry-run)</b>" : "🧹 <b>Inbox R2</b>"}\n` +
      `Scanned: ${summary.scanned}\n` +
      `Deleted: ${summary.deleted}\n` +
      `Freed: ${mb} MB`
    await sendTelegram(text)
  }
}

export const config = {
  name: "cleanup-inbox-attachments",
  schedule: "0 4 * * *",
}
