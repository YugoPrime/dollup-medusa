import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

type CreatePreorderProductBody = {
  title: string
  sheinUrl: string
  sheinPriceUsd: number
  imageUrl: string
  description?: string
  colors?: string[]
  sizes?: string[]
  salesChannelId?: string
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Partial<CreatePreorderProductBody>

  const errors: string[] = []
  if (!body.title || typeof body.title !== "string") errors.push("title required")
  if (!body.sheinUrl || typeof body.sheinUrl !== "string") errors.push("sheinUrl required")
  if (typeof body.sheinPriceUsd !== "number" || !(body.sheinPriceUsd > 0)) {
    errors.push("sheinPriceUsd must be a positive number")
  }
  if (!body.imageUrl || typeof body.imageUrl !== "string") errors.push("imageUrl required")

  if (errors.length > 0) {
    res.status(400).json({ message: errors.join("; ") })
    return
  }

  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(body.sheinUrl!)) {
    res.status(400).json({ message: "sheinUrl must be a https://shein.com or https://m.shein.com URL" })
    return
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const preview = await svc.previewPrice({ sheinPriceUsd: body.sheinPriceUsd! })
  const settings = await svc.getSettings()

  const colors = body.colors?.length ? body.colors : ["Default"]
  const sizes = body.sizes?.length ? body.sizes : ["One Size"]

  const variants = colors.flatMap((color) =>
    sizes.map((size) => ({
      title: `${color} / ${size}`,
      sku: undefined,
      options: { Color: color, Size: size },
      prices: [{ currency_code: "mur", amount: preview.finalPriceMur * 100 }],
      manage_inventory: false,
    })),
  )

  const handle = body.title!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") +
    "-preorder-" +
    Date.now().toString(36)

  const result = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: body.title!,
          handle,
          description: body.description ?? "",
          status: "published",
          images: [{ url: body.imageUrl! }],
          thumbnail: body.imageUrl!,
          options: [
            { title: "Color", values: colors },
            { title: "Size", values: sizes },
          ],
          variants,
          metadata: {
            is_preorder: true,
            shein_url: body.sheinUrl!,
            shein_price_usd: body.sheinPriceUsd!,
            preorder_fx_rate: preview.fxRateUsed,
            preorder_eta_min_days: settings.eta_min_days,
            preorder_eta_max_days: settings.eta_max_days,
            preorder_priced_at: new Date().toISOString(),
          },
          sales_channels: body.salesChannelId
            ? [{ id: body.salesChannelId }]
            : undefined,
        },
      ],
    },
  })

  const created = (result.result as { id: string }[])[0]
  res.json({ product: created, preview })
}
