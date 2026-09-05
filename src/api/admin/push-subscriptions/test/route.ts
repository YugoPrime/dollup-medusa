import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ADMIN_PUSH_MODULE } from "../../../../modules/admin-push"
import type AdminPushModuleService from "../../../../modules/admin-push/service"
import { getAdminUrl, isWebPushConfigured, sendWebPush } from "../../../../lib/web-push"

// Sends a test notification to ONE device so the owner can confirm the
// install → enable → receive loop on their phone from Settings → Notifications.
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  if (!isWebPushConfigured()) {
    res.status(503).json({ message: "Push is not configured on the server (VAPID_* missing)." })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  if (!endpoint) {
    res.status(400).json({ message: "endpoint is required" })
    return
  }
  const service = req.scope.resolve<AdminPushModuleService>(ADMIN_PUSH_MODULE)
  const sub = await service.findByEndpoint(endpoint)
  if (!sub) {
    res.status(404).json({ message: "This device is not subscribed. Enable notifications first." })
    return
  }
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const result = await sendWebPush(
    logger,
    { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    {
      title: "Test notification",
      body: "Doll Up Admin push is working on this device.",
      url: `${getAdminUrl()}/settings/notifications`,
      tag: "test",
    },
  )
  if (!result.ok) {
    if (result.gone) await service.removeByEndpoint(endpoint)
    res.status(502).json({ message: result.message })
    return
  }
  res.json({ ok: true })
}
