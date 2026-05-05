import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260505065000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "loyalty_settings" (' +
        '"id" text not null, ' +
        '"earn_rate_per_100_mur" integer not null default 1, ' +
        '"redeem_rate_mur_per_100_pts" integer not null default 50, ' +
        '"min_redeem_points" integer not null default 500, ' +
        '"welcome_bonus_points" integer not null default 100, ' +
        '"points_expiry_months" integer null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "loyalty_settings_pkey" primary key ("id"));',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "loyalty_settings" cascade;')
  }
}
