import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"
import type { ProductLike } from "../../../../../../modules/stories/snapshot"

/**
 * Wires the stories picker to the Medusa product module. The product module
 * returns rich Product entities; we shape them into ProductLike for the picker.
 *
 * `category_id` filter uses Medusa's product.categories relation.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const planId = req.params.id
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const productService = req.scope.resolve<IProductModuleService>(Modules.PRODUCT)

  const productSource = async (filter: { category_id?: string }): Promise<ProductLike[]> => {
    const where: Record<string, unknown> = { status: "published" }
    if (filter.category_id) {
      where.categories = { id: filter.category_id }
    }
    const products = await productService.listProducts(where, {
      take: 500,
      relations: [
        "variants",
        "variants.prices",
        "variants.options",
        "variants.options.option",
        "images",
      ],
    })
    return products.map(toProductLike)
  }

  try {
    await stories.regeneratePlan(planId, { productSource })
    const slots = (await stories.listStorySlots({ plan_id: planId }))
      .sort((a, b) => a.slot_index - b.slot_index)
    res.json({ slots })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Regenerate failed"
    const status = /completed/i.test(msg) ? 409 : 400
    res.status(status).json({ message: msg })
  }
}

function toProductLike(p: any): ProductLike {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    variants: (p.variants ?? []).map((v: any) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      inventory_quantity: v.inventory_quantity ?? 0,
      prices: (v.prices ?? []).map((pr: any) => ({
        amount: pr.amount,
        currency_code: pr.currency_code,
      })),
      options: Object.fromEntries(
        (v.options ?? []).map((o: any) => [
          o.option?.title?.toLowerCase() ?? "opt",
          o.value,
        ]),
      ),
      images: (p.images ?? []).map((img: any) => ({ url: img.url })),
    })),
  }
}
