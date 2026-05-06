import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { STORE_CONFIG_MODULE } from "../../../modules/store-config"
import type StoreConfigModuleService from "../../../modules/store-config/service"

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const service =
    req.scope.resolve<StoreConfigModuleService>(STORE_CONFIG_MODULE)
  const [shipping, store] = await Promise.all([
    service.getShippingSettings(),
    service.getStoreSettings(),
  ])

  res.json({
    config: {
      shipping: {
        free_shipping_threshold_mur: shipping.free_shipping_threshold_mur,
        return_fee_mur: shipping.return_fee_mur,
        preorder_eta_copy: shipping.preorder_eta_copy,
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
