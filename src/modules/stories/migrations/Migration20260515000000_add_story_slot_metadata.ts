import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260515000000_add_story_slot_metadata extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "story_slot" add column if not exists "metadata" jsonb null;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "story_slot" drop column if exists "metadata";',
    )
  }
}

