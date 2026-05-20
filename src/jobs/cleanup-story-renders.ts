import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { runR2CleanupOnce } from "../lib/cleanup-stale-story-renders"
import { sendTelegram } from "../lib/telegram"

/**
 * Daily R2 housekeeping for story MP4s. Each render writes a new
 * `stories/<slotId>/<hash>.mp4` so re-rendering a slot leaves the old hash
 * behind — over time the bucket accumulates dead bytes. This job sweeps:
 *
 *   - Orphan keys (key shape doesn't match the schema)
 *   - Slot deleted but its MP4 still in R2
 *   - Posted > 7 days ago (story is well past IG/FB's 24h Story window)
 *   - Stale re-renders (an older hash that's no longer the slot's "current")
 *
 * Gated on STORIES_R2_CLEANUP_ENABLED=true so we don't auto-delete during
 * setup / before operators have validated the rules. STORIES_R2_CLEANUP_DRY_RUN
 * forces a no-op pass that still logs + Telegrams the would-be impact so
 * you can preview before flipping the kill-switch.
 *
 * Cron: 03:30 Mauritius time daily. Picked to avoid the 18:00 plan creation
 * and 18:30 render daemon windows.
 */
export default async function cleanupStoryRenders(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (process.env.STORIES_R2_CLEANUP_ENABLED !== "true") {
    logger.info(
      "[cleanup-story-renders] STORIES_R2_CLEANUP_ENABLED!=true, skipping",
    )
    return
  }

  const dryRun = process.env.STORIES_R2_CLEANUP_DRY_RUN === "true"

  const summary = await runR2CleanupOnce(container, { dryRun })

  const mb = (summary.bytes_freed / (1024 * 1024)).toFixed(1)
  const prefix = summary.dry_run ? "DRY-RUN " : ""
  const line =
    `[cleanup-story-renders] ${prefix}scanned=${summary.scanned} ` +
    `deleted=${summary.deleted} kept=${summary.kept} ` +
    `freed=${mb}MB errors=${summary.errors.length}`
  logger.info(line)

  // Only ping Telegram when there's something interesting to report — no point
  // pinging "scanned 0 deleted 0" every night.
  if (
    summary.deleted > 0 ||
    summary.errors.length > 0 ||
    (summary.dry_run && summary.bytes_freed > 0)
  ) {
    const errLines =
      summary.errors.length > 0
        ? `\n\n<i>Errors:</i>\n` +
          summary.errors
            .slice(0, 5)
            .map((e) => `• ${e.key}: ${e.message}`)
            .join("\n")
        : ""
    const text =
      `${summary.dry_run ? "🔍 <b>R2 cleanup (dry-run)</b>" : "🧹 <b>R2 cleanup</b>"}\n` +
      `Scanned: ${summary.scanned}\n` +
      `Deleted: ${summary.deleted}\n` +
      `Freed: ${mb} MB${errLines}`
    await sendTelegram(text)
  }
}

export const config = {
  name: "cleanup-story-renders",
  // 03:30 Mauritius time = 23:30 UTC the previous day. Medusa cron uses
  // process timezone. Confirm Coolify container TZ is set to Indian/Mauritius
  // (or convert this to "30 23 * * *" if container runs in UTC).
  schedule: "30 3 * * *",
}
