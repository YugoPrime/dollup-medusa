import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationSizeRequests20260514190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "size_request" (' +
        '"id" text not null, ' +
        '"platform" text not null, ' +
        '"contact" text not null, ' +
        '"note" text not null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "size_request_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "size_request_created_at_idx" on "size_request" ("created_at");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "size_request" cascade;')
  }
}
