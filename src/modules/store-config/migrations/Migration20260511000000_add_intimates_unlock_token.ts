import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260511000000_add_intimates_unlock_token extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "store_settings" add column if not exists ' +
        '"intimates_unlock_token" text not null default \'\';',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "store_settings" drop column if exists "intimates_unlock_token";',
    )
  }
}
