import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260614000000_add_collection_boost extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "story_settings" add column if not exists "collection_boost" integer not null default 3;',
    )
    this.addSql(
      'alter table "story_settings" add column if not exists "collection_boost_days" integer not null default 14;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "story_settings" drop column if exists "collection_boost";',
    )
    this.addSql(
      'alter table "story_settings" drop column if exists "collection_boost_days";',
    )
  }
}
