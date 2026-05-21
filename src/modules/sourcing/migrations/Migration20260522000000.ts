import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260522000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "draft_item" ' +
        'add column if not exists "category_id" text null;',
    )
    this.addSql(
      'create index if not exists "IDX_draft_item_category_id" on "draft_item" ("category_id") where "deleted_at" is null and "category_id" is not null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_draft_item_category_id";')
    this.addSql(
      'alter table if exists "draft_item" drop column if exists "category_id";',
    )
  }
}
