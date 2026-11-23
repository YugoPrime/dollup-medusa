import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { searchCatalogueProducts } from "../../../../modules/newsletter/catalogue-source"
import { parseList, sendError } from "../../../../modules/newsletter/route-deps"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>
    const list = parseList(typeof query.list === "string" && query.list ? query.list : "main")
    const q = typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined
    const categoryId =
      typeof query.category_id === "string" && query.category_id ? query.category_id : undefined
    res.json({ products: await searchCatalogueProducts(req.scope, { list, q, categoryId }) })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
