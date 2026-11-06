import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../modules/stories"
import type StoriesModuleService from "../../../modules/stories/service"
import {
  applyCallback,
  handleRenderCallback,
} from "../../../modules/stories-render/cloud/callback"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const secret = process.env.STORY_RENDER_CALLBACK_SECRET
  if (!secret) {
    console.error(
      "[stories-render:callback] STORY_RENDER_CALLBACK_SECRET is not set"
    )
    res.status(500).json({ error: "callback secret not configured" })
    return
  }

  const stories = req.scope.resolve(STORIES_MODULE) as StoriesModuleService
  const result = await handleRenderCallback(
    {
      apply: (body) => applyCallback(stories, body, new Date()),
      secret,
      nowSec: Math.floor(Date.now() / 1000),
    },
    req.body as Buffer,
    req.headers["x-render-signature"] as string | undefined
  )
  res.status(result.status).json(result.body)
}
