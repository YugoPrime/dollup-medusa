import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_RENDER_MODULE } from "../../../../modules/stories-render"
import type StoriesRenderModuleService from "../../../../modules/stories-render/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const svc = req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
  const templates = await svc.list()
  res.status(200).json({ templates })
}

