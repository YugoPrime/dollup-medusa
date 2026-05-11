import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../modules/store-config"
import type StoreConfigModuleService from "../../../modules/store-config/service"

// Storefront posts { token } here; backend constant-time compares against the
// stored token and returns { ok: boolean }. The token itself is never exposed
// in any GET response — it only lives in the DB and is checked here.
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { token?: unknown }
  const candidate = typeof body.token === "string" ? body.token : ""

  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const ok = await service.verifyIntimatesUnlockToken(candidate)

  if (!ok) {
    res.status(401).json({ ok: false })
    return
  }
  res.json({ ok: true })
}
