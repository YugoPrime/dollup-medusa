import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { loadCatalogueProducts, searchCatalogueProducts } from "../../../../modules/newsletter/catalogue-source"
import { parseIdsParam, parseList, pickerRowsInOrder, sendError } from "../../../../modules/newsletter/route-deps"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>
    if (typeof query.ids === "string" && query.ids.trim()) {
      // Chosen products for the editor: no list/adult/unlisted filtering (send time still filters).
      const ids = parseIdsParam(query.ids)
      const products = await loadCatalogueProducts(req.scope, ids)
      return res.json({ products: pickerRowsInOrder(ids, products) })
    }
    const list = parseList(typeof query.list === "string" && query.list ? query.list : "main")
    const q = typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined
    const categoryId =
      typeof query.category_id === "string" && query.category_id ? query.category_id : undefined
    res.json({ products: await searchCatalogueProducts(req.scope, { list, q, categoryId }) })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
