import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { uploadStoryRenderToR2 } from "../../../../../../lib/r2-story-uploader"
import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"
import { STORIES_RENDER_MODULE } from "../../../../../../modules/stories-render"
import type StoriesRenderModuleService from "../../../../../../modules/stories-render/service"
import type { RenderRequest } from "../../../../../../modules/stories-render/types"

const inFlight = new Set<string>()

type RenderBody = Partial<RenderRequest>

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slotId = req.params.id
  const body = (req.body ?? {}) as RenderBody

  if (typeof body.template_slug !== "string" || body.template_slug.length === 0) {
    res.status(400).json({ message: "template_slug required" })
    return
  }
  if (body.slot_inputs !== undefined && !isStringMap(body.slot_inputs)) {
    res.status(400).json({ message: "slot_inputs must be an object of strings" })
    return
  }
  if (body.text_overrides !== undefined && !isStringMap(body.text_overrides)) {
    res.status(400).json({ message: "text_overrides must be an object of strings" })
    return
  }
  if (inFlight.has(slotId)) {
    res.status(409).json({ message: "Render in progress" })
    return
  }

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  try {
    const [slot] = await stories.listStorySlots({ id: slotId })
    if (!slot) {
      res.status(404).json({ message: "Slot not found" })
      return
    }
    if (slot.posted_at) {
      res.status(409).json({ message: "Slot is already posted" })
      return
    }

    inFlight.add(slotId)

    const renderSvc =
      req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
    renderSvc.uploadToR2 = uploadStoryRenderToR2

    await stories.updateSlotMetadata(slotId, {
      render_started_at: new Date().toISOString(),
      render_template_slug: body.template_slug,
      render_error: null,
    })

    const renderRequest: RenderRequest = {
      template_slug: body.template_slug,
      slot_inputs: body.slot_inputs ?? {},
      text_overrides: body.text_overrides ?? {},
    }

    res.status(202).json({
      status: "queued",
      slot_id: slotId,
      template_slug: body.template_slug,
    })

    void (async () => {
      try {
        const render = await renderSvc.render(slotId, renderRequest)
        await stories.updateSlotMetadata(slotId, {
          render,
          render_started_at: null,
          render_error: null,
        })
      } catch (err) {
        console.error("[stories-render] background render failed", err)
        await persistRenderError(stories, slotId, err)
      } finally {
        inFlight.delete(slotId)
      }
    })()
  } catch (err) {
    await persistRenderError(stories, slotId, err)
    sendRenderError(res, err)
    inFlight.delete(slotId)
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

function sendRenderError(res: MedusaResponse, err: unknown): void {
  const e = err as { name?: string; message?: string; stderrTail?: string }
  if (e.name === "RequiredSlotEmptyError" || e.name === "TextOverrideTooLongError") {
    res.status(400).json({ message: e.message })
    return
  }
  if (e.name === "TemplateNotFoundError") {
    res.status(404).json({ message: e.message })
    return
  }
  if (e.name === "RenderTimeoutError") {
    res.status(504).json({ message: e.message })
    return
  }
  if (e.name === "RenderCliError") {
    res.status(500).json({
      message: e.stderrTail ? `Render failed\n\n${e.stderrTail}` : "Render failed",
      stderr_tail: e.stderrTail ?? e.message,
    })
    return
  }
  console.error("[stories-render] unexpected error", err)
  res.status(500).json({ message: e.message ?? "Render failed" })
}

async function persistRenderError(
  stories: StoriesModuleService,
  slotId: string,
  err: unknown,
): Promise<void> {
  const e = err as { name?: string; message?: string; stderrTail?: string }
  try {
    await stories.updateSlotMetadata(slotId, {
      render_error: {
        message: e.message ?? "Render failed",
        name: e.name ?? "Error",
        stderr_tail: e.stderrTail ?? null,
        failed_at: new Date().toISOString(),
      },
      render_started_at: null,
    })
  } catch (metadataErr) {
    console.error("[stories-render] failed to persist render error", metadataErr)
  }
}
