import {
  ContainerRegistrationKeys,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils"

import { collectCategoryAndDescendants } from "../stories/product-source"
import {
  isAdultProduct,
  isUnlistedProduct,
  toPickerRow,
  type CatalogueProduct,
  type PickerRow,
} from "./lib/catalogue"
import type { NewsletterList } from "./types"

type Scope = { resolve(key: any): any }

const MAX_PICKER_ROWS = 60

// Variant fields mirror STORY_PRODUCT_FIELDS (stock levels + calculated price).
const CATALOGUE_FIELDS = [
  "id",
  "title",
  "handle",
  "status",
  "thumbnail",
  "metadata",
  "images.url",
  "categories.handle",
  "variants.manage_inventory",
  "variants.inventory_items.required_quantity",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
  "variants.calculated_price.*",
]

export async function loadCatalogueProducts(
  scope: Scope,
  ids: string[],
): Promise<CatalogueProduct[]> {
  if (ids.length === 0) return []
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: CATALOGUE_FIELDS,
    filters: { id: ids },
    context: {
      variants: {
        calculated_price: QueryContext({ currency_code: "mur" }),
      },
    },
  })
  return data as CatalogueProduct[]
}

export async function searchCatalogueProducts(
  scope: Scope,
  f: { list: NewsletterList; q?: string; categoryId?: string },
): Promise<PickerRow[]> {
  const productService = scope.resolve(Modules.PRODUCT)
  const q = f.q?.trim()

  let categoryIds: string[] | undefined
  if (f.categoryId) {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: cats } = await query.graph({
      entity: "product_category",
      fields: ["id", "parent_category_id"],
      pagination: { take: 1000 },
    })
    categoryIds = collectCategoryAndDescendants(
      cats as Array<{ id: string; parent_category_id?: string | null }>,
      f.categoryId,
    )
  }

  const found = await productService.listProducts(
    {
      ...(q ? { q } : {}),
      status: "published",
      ...(categoryIds ? { categories: { id: categoryIds } } : {}),
    },
    { take: MAX_PICKER_ROWS, select: ["id"], order: { created_at: "DESC" } },
  )

  const ids = (found as Array<{ id: string }>).map((p) => p.id)
  const loaded = new Map(
    (await loadCatalogueProducts(scope, ids)).map((p) => [p.id, p]),
  )
  return ids
    .map((id) => loaded.get(id))
    .filter((p): p is CatalogueProduct => !!p)
    .filter((p) => !isUnlistedProduct(p) && !(f.list === "main" && isAdultProduct(p)))
    .map(toPickerRow)
}
