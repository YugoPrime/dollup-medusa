import { ModuleProvider, Modules } from "@medusajs/framework/utils"

import ResendNotificationProviderService from "./service"

export const RESEND_NOTIFICATION_MODULE = "resend"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [ResendNotificationProviderService],
})
