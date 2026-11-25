import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationWishlistSignals20261125200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "wishlist_signal" (' +
        '"id" text not null, ' +
        '"anon_id" text not null, ' +
        '"product_id" text not null, ' +
        '"customer_id" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "wishlist_signal_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_wishlist_signal_anon_id_product_id_unique" on "wishlist_signal" ("anon_id", "product_id") where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "IDX_wishlist_signal_product_id" on "wishlist_signal" ("product_id") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "wishlist_signal" cascade;')
  }
}
