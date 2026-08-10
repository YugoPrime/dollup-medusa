import { model } from "@medusajs/framework/utils"

export const KnowledgeEntry = model.define("ai_knowledge_entry", {
  id: model.id({ prefix: "akn" }).primaryKey(),
  title: model.text(),
  body: model.text(),
  tags: model.json().nullable(),
  is_active: model.boolean().default(true),
  updated_by: model.text().nullable(),
})
