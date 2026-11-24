import { Module } from "@medusajs/framework/utils"

import StockSnapshotsModuleService from "./service"

export const STOCK_SNAPSHOTS_MODULE = "stock_snapshots"

export default Module(STOCK_SNAPSHOTS_MODULE, {
  service: StockSnapshotsModuleService,
})
