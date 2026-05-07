import { MedusaService } from "@medusajs/framework/utils"

import StoryPlan from "./models/story-plan"
import StorySlot from "./models/story-slot"
import PublicationLog from "./models/publication-log"
import StorySettings from "./models/story-settings"
// buildSnapshot is wired in by Task 13 (regeneratePlan picker).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { buildSnapshot, type ProductLike } from "./snapshot"

export const STORY_SETTINGS_ID = "story_settings"

export type StorySettingsDTO = {
  id: string
  anti_repeat_days: number
  caption_template: string
  default_distribution: Array<{ category_id: string; count: number }>
  default_schedule: string[]
}

export type UpdateStorySettingsInput = Partial<Omit<StorySettingsDTO, "id">>

export const DEFAULT_STORY_SETTINGS: Omit<StorySettingsDTO, "id"> = {
  anti_repeat_days: 7,
  caption_template: "{name} — Rs {price} · {sizes} · {link}",
  default_distribution: [],
  default_schedule: [],
}

class StoriesModuleService extends MedusaService({
  StoryPlan,
  StorySlot,
  PublicationLog,
  StorySettings,
}) {
  async getSettings(): Promise<StorySettingsDTO> {
    const existing = await this.listStorySettings({ id: STORY_SETTINGS_ID })
    if (existing[0]) return existing[0] as unknown as StorySettingsDTO

    const created = await this.createStorySettings({
      id: STORY_SETTINGS_ID,
      ...DEFAULT_STORY_SETTINGS,
    } as unknown as Parameters<this["createStorySettings"]>[0])
    return created as unknown as StorySettingsDTO
  }

  async updateSettings(
    input: UpdateStorySettingsInput,
  ): Promise<StorySettingsDTO> {
    await this.getSettings()
    const updated = await this.updateStorySettings({
      id: STORY_SETTINGS_ID,
      ...input,
    } as unknown as Parameters<this["updateStorySettings"]>[0])
    return updated as unknown as StorySettingsDTO
  }
}

export default StoriesModuleService
