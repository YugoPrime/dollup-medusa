import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260509181500 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "sourcing_settings" (' +
        '"id" text not null, ' +
        '"fx_rate" numeric(10,3) not null default 46.000, ' +
        '"landed_multiplier_default" numeric(5,3) not null default 1.500, ' +
        '"markup_multiplier" numeric(5,3) not null default 2.500, ' +
        '"round_step" integer not null default 50, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "sourcing_settings_pkey" primary key ("id"));',
    )
    // Insert the singleton row with id='default'.
    this.addSql(
      "insert into \"sourcing_settings\" (\"id\") values ('default') on conflict (\"id\") do nothing;",
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "sourcing_settings" cascade;')
  }
}
