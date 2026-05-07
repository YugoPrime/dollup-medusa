import { MedusaService } from "@medusajs/framework/utils"

import StoryPlan from "./models/story-plan"
import StorySlot from "./models/story-slot"
import PublicationLog from "./models/publication-log"
import StorySettings from "./models/story-settings"

class StoriesModuleService extends MedusaService({
  StoryPlan,
  StorySlot,
  PublicationLog,
  StorySettings,
}) {}

export default StoriesModuleService
