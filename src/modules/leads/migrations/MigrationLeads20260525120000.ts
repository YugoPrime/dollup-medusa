import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationLeads20260525120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "lead_list" (' +
        '"id" text not null, ' +
        '"name" text not null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "lead_list_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "lead_list_name_unique" on "lead_list" ("name") where "deleted_at" is null;',
    )

    // Insert the General list with a stable, known id so we can reference it
    // from the lead.list_id backfill in the same migration without a separate
    // SELECT round-trip. Subsequent lists get random ids from the service.
    // NOTE: can't use ON CONFLICT against the partial unique index created
    // above in the same transaction (Postgres infer_arbiter_indexes fails,
    // error 42P10). Use WHERE NOT EXISTS guard instead.
    this.addSql(
      "insert into \"lead_list\" (\"id\", \"name\") " +
        "select 'leadlist_general', 'General' " +
        "where not exists (select 1 from \"lead_list\" where \"name\" = 'General' and \"deleted_at\" is null);",
    )

    this.addSql('alter table "lead" add column if not exists "list_id" text null;')
    this.addSql(
      "update \"lead\" set \"list_id\" = 'leadlist_general' where \"list_id\" is null;",
    )
    this.addSql('alter table "lead" alter column "list_id" set not null;')
    this.addSql(
      'create index if not exists "lead_list_id_idx" on "lead" ("list_id");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "lead_list_id_idx";')
    this.addSql('alter table "lead" drop column if exists "list_id";')
    this.addSql('drop index if exists "lead_list_name_unique";')
    this.addSql('drop table if exists "lead_list" cascade;')
  }
}
