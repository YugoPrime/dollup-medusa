import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationLeads20260512120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "lead" (' +
        '"id" text not null, ' +
        '"name" text null, ' +
        '"phone" text null, ' +
        '"note" text null, ' +
        '"used_at" timestamptz null, ' +
        '"used_for_order_id" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "lead_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "lead_used_at_idx" on "lead" ("used_at");',
    )
    this.addSql(
      'create index if not exists "lead_created_at_idx" on "lead" ("created_at");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "lead" cascade;')
  }
}
