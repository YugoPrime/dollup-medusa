import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260527000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "draft_item" ' +
        'add column if not exists "color_images" jsonb null;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table if exists "draft_item" drop column if exists "color_images";',
    )
  }
}
