import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds story_settings.stock_alert_threshold (default 0).
 * Threshold of 0 = "alert only when picked product is fully out".
 */
export class Migration20260508000000_add_stock_alert_threshold extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "story_settings" add column if not exists ' +
        '"stock_alert_threshold" integer not null default 0;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "story_settings" drop column if exists "stock_alert_threshold";',
    )
  }
}
