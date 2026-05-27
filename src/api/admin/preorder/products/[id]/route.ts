import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * DELETE /admin/preorder/products/[id]
 *
 * Soft-delete by flipping status to "draft" — keeps the product (and its
 * variants/metadata/SHEIN URL) for reference but hides it from the preorder
 * storefront. Use PATCH with {status:"published"} to re-enable.
 *
 * We intentionally don't hard-delete here. Hard delete would orphan any
 * in-flight orders that reference the variant (rare but messy). Soft-delete
 * via status=draft is the lighter, reversible choice.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const { id } = req.params as { id: string }
  if (!id) {
    res.status(400).json({ message: "product id required" })
    return
  }

  await updateProductsWorkflow(req.scope).run({
    input: {
      selector: { id },
      update: { status: "draft" },
    },
  })

  res.json({ ok: true, id, status: "draft" })
}

/**
 * PATCH /admin/preorder/products/[id]
 *
 * Currently only supports status toggle. Allows admin to re-publish a soft-
 * deleted product. Body: { status: "draft" | "published" }.
 */
export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const { id } = req.params as { id: string }
  if (!id) {
    res.status(400).json({ message: "product id required" })
    return
  }

  const body = (req.body ?? {}) as { status?: "draft" | "published" }
  if (body.status !== "draft" && body.status !== "published") {
    res.status(400).json({
      message: 'status must be "draft" or "published"',
    })
    return
  }

  await updateProductsWorkflow(req.scope).run({
    input: {
      selector: { id },
      update: { status: body.status },
    },
  })

  res.json({ ok: true, id, status: body.status })
}
