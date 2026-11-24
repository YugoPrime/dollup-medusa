import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationStockSnapshots20261125200000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "stock_snapshot" (' +
        '"id" text not null, ' +
        '"day" text not null, ' +
        '"units" integer not null, ' +
        '"cost_value_mur" integer not null, ' +
        '"retail_value_mur" integer not null, ' +
        '"uncosted_units" integer not null, ' +
        '"products" integer not null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "stock_snapshot_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_stock_snapshot_day_unique" on "stock_snapshot" ("day") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "stock_snapshot" cascade;')
  }
}
