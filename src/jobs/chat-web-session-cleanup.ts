/**
 * Closes web chat threads whose session has been idle for 30 days. The session
 * id is the visitor's bearer credential, so an abandoned one should not stay
 * live forever. Closing (not deleting) keeps the conversation readable in
 * /inbox while taking it out of the open queue.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { CHAT_MODULE } from "../modules/chat"
import type ChatModuleService from "../modules/chat/service"

const IDLE_MS = 30 * 24 * 60 * 60 * 1000

export default async function chatWebSessionCleanup(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const chat = container.resolve<ChatModuleService>(CHAT_MODULE)

  const threads = await chat.listThreads({ channel: "web", status: "open" })
  const cutoff = Date.now() - IDLE_MS
  let closed = 0

  for (const t of threads as any[]) {
    // A thread with no last_message_at has a contact and session but no message
    // yet — created and abandoned. Treat it as idle so those don't accumulate.
    const last = t.last_message_at ? new Date(t.last_message_at).getTime() : 0
    if (last > cutoff) continue
    try {
      await chat.updateThreads({ id: t.id, status: "closed" } as never)
      closed++
    } catch (e) {
      logger.error(`[chat-cleanup] close failed for ${t.id}: ${(e as Error).message}`)
    }
  }

  if (closed > 0) logger.info(`[chat-cleanup] closed ${closed} idle web threads`)
}

export const config = {
  name: "chat-web-session-cleanup",
  // Daily at 03:20 UTC — 07:20 in Mauritius (UTC+4), off-peak either way.
  schedule: "20 3 * * *",
}
