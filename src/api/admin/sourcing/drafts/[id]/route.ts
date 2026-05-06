import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../modules/sourcing/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    const draft = await service.retrieveDraft(req.params.id)
    const items = await service.listItems(draft.id)
    const itemsWithVariants = await Promise.all(
      items.map(async (item) => ({
        ...item,
        variants: await service.listVariants(item.id),
      })),
    )
    res.json({ draft: { ...draft, items: itemsWithVariants } })
  } catch (err) {
    res.status(404).json({
      message: (err as Error).message ?? "Draft not found",
    })
  }
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    if (body.archived === true) {
      await service.archiveDraft(req.params.id)
      return res.json({ draft: await service.retrieveDraft(req.params.id) })
    }
    const draft = await service.updateDraftMeta(req.params.id, {
      notes: body.notes === undefined ? undefined : (body.notes as string | null),
      landed_cost_multiplier:
        body.landed_cost_multiplier === undefined
          ? undefined
          : Number(body.landed_cost_multiplier),
      paid_at: parseDate(body.paid_at),
      shipped_at: parseDate(body.shipped_at),
      received_at: parseDate(body.received_at),
    })
    res.json({ draft })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to update draft",
    })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    await service.deleteDraftStrict(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to delete draft",
    })
  }
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === "") return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return undefined
  return d
}
