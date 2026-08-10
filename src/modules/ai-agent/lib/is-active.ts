import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Single source of truth for the widget's `ai_active` flag: true only when the
 * env kill switch is off, the settings row is enabled, mode is "auto", the web
 * channel is on, and the monthly budget has room.
 *
 * Returns false until the ai-agent module exists (Phase 3) — which is exactly
 * the behaviour we want while the widget ships human-only: the widget shows
 * "our team will reply shortly" instead of a typing indicator that resolves to
 * nothing.
 */
export async function isAiActive(_scope: MedusaContainer): Promise<boolean> {
  return false
}
