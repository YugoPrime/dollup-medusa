import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261027000000_add_focus extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "story_settings" add column if not exists "focus_tag" text null;',
    )
    this.addSql(
      'alter table "story_settings" add column if not exists "focus_until" text null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('alter table "story_settings" drop column if exists "focus_tag";')
    this.addSql('alter table "story_settings" drop column if exists "focus_until";')
  }
}
