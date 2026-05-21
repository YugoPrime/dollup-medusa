import fs from "node:fs/promises"
import path from "node:path"

import type {
  TemplateMeta,
  TemplateSlotDef,
  TemplateTextOverride,
} from "./types"

export class TemplateNotFoundError extends Error {
  name = "TemplateNotFoundError"
}

export class TemplateMetaInvalidError extends Error {
  name = "TemplateMetaInvalidError"
}

const CATEGORIES = new Set([
  "single-product",
  "single-product-multi-image",
  "multi-product",
  "editorial",
  "ops",
])
const HINTS = new Set(["front", "back", "detail", "lifestyle", "cutout", "model"])
const WAVES = new Set([0, 1, 2, 3])

function assertSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
    throw new TemplateNotFoundError(`Template not found: ${slug}`)
  }
}

function invalid(slug: string, message: string): never {
  throw new TemplateMetaInvalidError(`${slug}: meta.json invalid (${message})`)
}

function stringField(obj: Record<string, unknown>, key: string, slug: string): string {
  const value = obj[key]
  if (typeof value !== "string" || value.length === 0) invalid(slug, `${key} must be a string`)
  return value
}

function validateSlot(slot: unknown, slug: string): TemplateSlotDef {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    invalid(slug, "slot must be an object")
  }
  const s = slot as Record<string, unknown>
  const id = stringField(s, "id", slug)
  const hint = stringField(s, "hint", slug)
  const label = stringField(s, "label", slug)
  if (!HINTS.has(hint)) invalid(slug, `slot ${id} has unsupported hint`)
  if (typeof s.required !== "boolean") invalid(slug, `slot ${id} required must be boolean`)
  return { id, hint: hint as TemplateSlotDef["hint"], label, required: s.required }
}

function validateOverride(override: unknown, slug: string): TemplateTextOverride {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    invalid(slug, "text override must be an object")
  }
  const o = override as Record<string, unknown>
  const id = stringField(o, "id", slug)
  // `default` may be an empty string for OPTIONAL overrides (e.g. on-sale's
  // discount_pct, which the picker only populates when there's a real
  // saving — empty default + CSS `:empty { display: none }` hides the
  // element when no value is provided). 2026-05-22.
  const defRaw = o.default
  if (typeof defRaw !== "string") invalid(slug, `text override ${id} default must be a string`)
  const def = defRaw as string
  if (!Number.isInteger(o.max_chars) || Number(o.max_chars) < 1) {
    invalid(slug, `text override ${id} max_chars must be a positive integer`)
  }
  return { id, default: def, max_chars: Number(o.max_chars) }
}

function validate(meta: unknown, slug: string): TemplateMeta {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    invalid(slug, "not object")
  }
  const m = meta as Record<string, unknown>
  const metaSlug = stringField(m, "slug", slug)
  if (metaSlug !== slug) invalid(slug, `slug mismatch (${metaSlug})`)
  const name = stringField(m, "name", slug)
  const category = stringField(m, "category", slug)
  if (!CATEGORIES.has(category)) invalid(slug, "unsupported category")
  if (!Number.isFinite(m.duration_seconds) || Number(m.duration_seconds) <= 0) {
    invalid(slug, "duration_seconds must be positive")
  }
  if (!WAVES.has(Number(m.wave))) invalid(slug, "wave must be 0, 1, 2, or 3")
  if (!Array.isArray(m.slots)) invalid(slug, "slots must be an array")
  if (!Array.isArray(m.text_overrides)) invalid(slug, "text_overrides must be an array")

  return {
    slug,
    name,
    category: category as TemplateMeta["category"],
    duration_seconds: Number(m.duration_seconds),
    wave: Number(m.wave) as TemplateMeta["wave"],
    slots: m.slots.map((slot) => validateSlot(slot, slug)),
    text_overrides: m.text_overrides.map((override) => validateOverride(override, slug)),
  }
}

export async function loadTemplate(slug: string, root: string): Promise<TemplateMeta> {
  assertSlug(slug)
  const metaPath = path.join(root, slug, "meta.json")
  let raw: string
  try {
    raw = await fs.readFile(metaPath, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TemplateNotFoundError(`Template not found: ${slug}`)
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    invalid(slug, "not JSON")
  }
  return validate(parsed, slug)
}

export async function listTemplates(root: string): Promise<TemplateMeta[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const slugs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort()

  const metas: TemplateMeta[] = []
  for (const slug of slugs) {
    try {
      metas.push(await loadTemplate(slug, root))
    } catch {
      // Ignore in-progress folders so one draft template does not break admin.
    }
  }
  return metas
}
