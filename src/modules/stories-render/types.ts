export type TemplateSlotHint =
  | "front"
  | "back"
  | "detail"
  | "lifestyle"
  | "cutout"
  | "model"

export type TemplateSlotDef = {
  id: string
  hint: TemplateSlotHint
  label: string
  required: boolean
}

export type TemplateTextOverride = {
  id: string
  default: string
  max_chars: number
}

export type TemplateMeta = {
  slug: string
  name: string
  category:
    | "single-product"
    | "single-product-multi-image"
    | "multi-product"
    | "editorial"
    | "ops"
  duration_seconds: number
  wave: 0 | 1 | 2 | 3
  slots: TemplateSlotDef[]
  text_overrides: TemplateTextOverride[]
}

export type RenderRequest = {
  template_slug: string
  slot_inputs: Record<string, string>
  text_overrides: Record<string, string>
  // Audio rotation context. When both are provided, the audio mixer picks
  // tracks from a per-plan permutation so the same day never reuses a track
  // (as long as track-count >= slot-count). Optional for back-compat with
  // ad-hoc renders (e.g. regen-template-previews) — those fall back to the
  // per-slot hash and can repeat.
  plan_id?: string
  slot_index?: number
}

export type RenderResult = {
  mp4_url: string
  template_slug: string
  slot_inputs: Record<string, string>
  text_overrides: Record<string, string>
  generated_at: string
  duration_ms: number
  width: number
  height: number
  fps: number
}

