import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { uploadStoryRenderToR2 } from "../../../../../../lib/r2-story-uploader"
import { STORIES_RENDER_MODULE } from "../../../../../../modules/stories-render"
import type StoriesRenderModuleService from "../../../../../../modules/stories-render/service"

const SAMPLE_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#f4c2c2"/>
          <stop offset="1" stop-color="#f5e6d8"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1920" fill="url(#g)"/>
      <rect x="180" y="290" width="720" height="1160" rx="320" fill="#fff8f0" opacity=".9"/>
      <text x="540" y="1520" text-anchor="middle" font-family="Arial" font-size="74" font-weight="700" fill="#2b2b2b">IS2364</text>
    </svg>
  `)

const SAMPLE_TEXT: Record<string, string> = {
  headline: "IN STOCK",
  subhead: "MUST HAVE",
  footer: "DM to ORDER",
  price: "Rs.1100",
  sku: "IS2364",
  size: "Size: S, M, L",
  old_price: "Rs.1500",
  new_price: "Rs.1100",
  status: "IN STOCK",
  step1: "1. DM us on Instagram",
  step2: "2. Send size + address",
  step3: "3. Delivery in 24h, COD",
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slug = req.params.slug
  const svc = req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
  svc.uploadToR2 = uploadStoryRenderToR2

  try {
    const meta = await svc.get(slug)
    const slotInputs = Object.fromEntries(meta.slots.map((slot) => [slot.id, SAMPLE_IMAGE]))
    const render = await svc.render(`sample_${slug}`, {
      template_slug: slug,
      slot_inputs: slotInputs,
      text_overrides: SAMPLE_TEXT,
    })
    res.status(200).json({ render })
  } catch (err) {
    const e = err as { name?: string; message?: string; stderrTail?: string }
    if (e.name === "TemplateNotFoundError") {
      res.status(404).json({ message: e.message })
      return
    }
    res.status(500).json({
      message: e.message ?? "Sample render failed",
      stderr_tail: e.stderrTail,
    })
  }
}

