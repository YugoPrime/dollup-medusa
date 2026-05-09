import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260509180000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "draft_item" ' +
        'add column if not exists "ref" text null, ' +
        'add column if not exists "selling_price_mur" numeric(10,2) null, ' +
        'add column if not exists "published_product_id" text null, ' +
        'add column if not exists "published_at" timestamptz null;',
    )
    this.addSql(
      'create unique index if not exists "IDX_draft_item_ref" on "draft_item" ("ref") where "deleted_at" is null and "ref" is not null;',
    )
    this.addSql(
      'create index if not exists "IDX_draft_item_published_product_id" on "draft_item" ("published_product_id") where "deleted_at" is null and "published_product_id" is not null;',
    )

    this.addSql(
      'alter table if exists "draft_variant" ' +
        'add column if not exists "received_qty" integer null, ' +
        'add column if not exists "override_price_mur" numeric(10,2) null;',
    )

    this.addSql(
      'alter table if exists "draft_order" ' +
        'add column if not exists "fx_rate" numeric(10,3) null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_draft_item_published_product_id";')
    this.addSql('drop index if exists "IDX_draft_item_ref";')
    this.addSql(
      'alter table if exists "draft_item" ' +
        'drop column if exists "ref", ' +
        'drop column if exists "selling_price_mur", ' +
        'drop column if exists "published_product_id", ' +
        'drop column if exists "published_at";',
    )
    this.addSql(
      'alter table if exists "draft_variant" ' +
        'drop column if exists "received_qty", ' +
        'drop column if exists "override_price_mur";',
    )
    this.addSql(
      'alter table if exists "draft_order" ' +
        'drop column if exists "fx_rate";',
    )
  }
}
