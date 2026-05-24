import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260525000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "preorder_settings" (' +
        '"id" text not null, ' +
        '"fx_rate_usd_to_mur" integer not null default 50, ' +
        '"customs_percent" integer not null default 25, ' +
        '"handling_tier_1_max" integer not null default 500, ' +
        '"handling_tier_1_fee" integer not null default 150, ' +
        '"handling_tier_2_max" integer not null default 1000, ' +
        '"handling_tier_2_fee" integer not null default 300, ' +
        '"handling_tier_3_max" integer not null default 2000, ' +
        '"handling_tier_3_fee" integer not null default 600, ' +
        '"handling_tier_4_flat" integer not null default 1000, ' +
        '"handling_tier_4_percent" integer not null default 30, ' +
        '"round_to_mur" integer not null default 10, ' +
        '"eta_min_days" integer not null default 15, ' +
        '"eta_max_days" integer not null default 20, ' +
        '"deposit_percent" integer not null default 75, ' +
        '"submissions_per_ip_per_hour" integer not null default 5, ' +
        '"submissions_per_day_total" integer not null default 50, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_settings_pkey" primary key ("id"));',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "preorder_settings" cascade;')
  }
}
