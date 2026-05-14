import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SIZE_REQUESTS_MODULE } from "../../../modules/size-requests"
import type SizeRequestsModuleService from "../../../modules/size-requests/service"
import type {
  CreateSizeRequestInput,
  SizeRequestPlatform,
} from "../../../modules/size-requests/service"

const ALLOWED_PLATFORMS: ReadonlySet<SizeRequestPlatform> = new Set([
  "whatsapp",
  "instagram",
  "messenger",
  "phone",
  "other",
])

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SizeRequestsModuleService>(
    SIZE_REQUESTS_MODULE,
  )
  const size_requests = await service.listActiveSizeRequests()
  res.json({ size_requests })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const platformRaw = typeof body.platform === "string" ? body.platform : ""
  if (!ALLOWED_PLATFORMS.has(platformRaw as SizeRequestPlatform)) {
    res.status(400).json({ message: `Unknown platform "${platformRaw}"` })
    return
  }
  const input: CreateSizeRequestInput = {
    platform: platformRaw as SizeRequestPlatform,
    contact: typeof body.contact === "string" ? body.contact : "",
    note: typeof body.note === "string" ? body.note : "",
  }

  const service = req.scope.resolve<SizeRequestsModuleService>(
    SIZE_REQUESTS_MODULE,
  )
  try {
    const size_request = await service.createSizeRequest(input)
    res.json({ size_request })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to create size request",
    })
  }
}
