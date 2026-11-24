import { Module } from "@medusajs/framework/utils"

import WishlistSignalsModuleService from "./service"

export const WISHLIST_SIGNALS_MODULE = "wishlist_signals"

export default Module(WISHLIST_SIGNALS_MODULE, {
  service: WishlistSignalsModuleService,
})
