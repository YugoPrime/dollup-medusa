import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { STORE_CONFIG_MODULE } from "../../../modules/store-config"
import type StoreConfigModuleService from "../../../modules/store-config/service"

type ShippingOptionPrice = {
  amount?: number | string | null
  currency_code?: string | null
}

type ShippingOptionRow = {
  id: string
  name?: string | null
  type?: { description?: string | null } | null
  prices?: ShippingOptionPrice[] | null
}

type PublicShippingOption = {
  id: string
  name: string
  amount: number
  currency_code: string
  description?: string
}

async function getPublicShippingOptions(
  req: MedusaStoreRequest,
): Promise<PublicShippingOption[]> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "shipping_option",
      fields: [
        "id",
        "name",
        "type.description",
        "prices.amount",
        "prices.currency_code",
      ],
    })
    const rows = (data ?? []) as ShippingOptionRow[]

    const out: PublicShippingOption[] = []
    for (const row of rows) {
      if (!row?.id || !row.name) continue

      const prices = (row.prices ?? []).filter(
        (p): p is ShippingOptionPrice & { amount: number | string } =>
          !!p && p.amount !== null && p.amount !== undefined,
      )
      if (prices.length === 0) continue

      const murPrice =
        prices.find((p) => (p.currency_code ?? "").toLowerCase() === "mur") ??
        prices[0]

      const amountNum = Number(murPrice.amount)
      if (!Number.isFinite(amountNum)) continue

      const description = row.type?.description?.trim()

      out.push({
        id: row.id,
        name: row.name,
        amount: amountNum,
        currency_code: (murPrice.currency_code ?? "mur").toLowerCase(),
        ...(description ? { description } : {}),
      })
    }
    return out
  } catch (err) {
    // Don't break the entire store-config response if shipping options can't
    // be fetched — log and return an empty list so the storefront can fall
    // back to its hardcoded defaults.
    // eslint-disable-next-line no-console
    console.error("[store-config] failed to load shipping options", err)
    return []
  }
}

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const [shipping, store, options] = await Promise.all([
    service.getShippingSettings(),
    service.getStoreSettings(),
    getPublicShippingOptions(req),
  ])

  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({
    config: {
      shipping: {
        free_shipping_threshold_mur: shipping.free_shipping_threshold_mur,
        return_fee_mur: shipping.return_fee_mur,
        preorder_eta_copy: shipping.preorder_eta_copy,
        options,
      },
      store: {
        contact_phone: store.contact_phone,
        contact_email: store.contact_email,
        contact_hours: store.contact_hours,
        instagram_url: store.instagram_url,
        facebook_url: store.facebook_url,
        tiktok_url: store.tiktok_url,
        whatsapp_url: store.whatsapp_url,
        footer_copyright: store.footer_copyright,
      },
    },
  })
}
