import { createHash } from "node:crypto"

import type { RenderRequest } from "./types"

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${sortedJson(obj[key])}`)
    .join(",")}}`
}

export function renderHash(req: RenderRequest): string {
  const canonical = sortedJson({
    template_slug: req.template_slug,
    slot_inputs: req.slot_inputs,
    text_overrides: req.text_overrides,
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

export function r2KeyFor(slotId: string, hash: string): string {
  return `stories/${slotId}/${hash}.mp4`
}

