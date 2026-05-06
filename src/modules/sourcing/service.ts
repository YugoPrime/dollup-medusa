import { MedusaService } from "@medusajs/framework/utils"

import Supplier from "./models/supplier"
import DraftOrder from "./models/draft-order"
import DraftItem from "./models/draft-item"
import DraftVariant from "./models/draft-variant"
import DraftCostHistory from "./models/draft-cost-history"

class SourcingModuleService extends MedusaService({
  Supplier,
  DraftOrder,
  DraftItem,
  DraftVariant,
  DraftCostHistory,
}) {}

export default SourcingModuleService
