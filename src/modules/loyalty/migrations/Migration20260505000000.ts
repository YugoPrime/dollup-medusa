import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Initial schema for the loyalty module.
 *
 * Tables:
 *   loyalty_account     — one row per customer
 *   loyalty_transaction — append-only ledger of every points movement
 *
 * Notes:
 *   - We deliberately do NOT add a foreign key to "customer". The loyalty
 *     module is logically independent — Medusa v2 modules are isolated,
 *     and cross-module FKs go through Module Links, not raw FKs.
 *   - account_id IS a FK because it's intra-module.
 *   - Soft delete columns are included on both tables to match Medusa's
 *     convention, even though we don't actively soft-delete today.
 */
export class Migration20260505000000 extends Migration {
  async up(): Promise<void> {
    // loyalty_account
    this.addSql(
      'create table if not exists "loyalty_account" (' +
        '"id" text not null, ' +
        '"customer_id" text not null, ' +
        '"points_balance" integer not null default 0, ' +
        '"lifetime_earned" integer not null default 0, ' +
        '"lifetime_redeemed" integer not null default 0, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "loyalty_account_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_loyalty_account_customer_id" ' +
        'on "loyalty_account" ("customer_id") where "deleted_at" is null;',
    )

    // loyalty_transaction
    this.addSql(
      'create table if not exists "loyalty_transaction" (' +
        '"id" text not null, ' +
        '"account_id" text not null, ' +
        '"type" text check ("type" in (\'earn\', \'redeem\', \'adjustment\', \'expire\')) not null, ' +
        '"points" integer not null, ' +
        '"reason" text not null, ' +
        '"order_id" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "loyalty_transaction_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "IDX_loyalty_transaction_account_id" ' +
        'on "loyalty_transaction" ("account_id");',
    )
    this.addSql(
      'create index if not exists "IDX_loyalty_transaction_order_id" ' +
        'on "loyalty_transaction" ("order_id") where "order_id" is not null;',
    )
    // Used by the order.placed subscriber's idempotency check.
    this.addSql(
      'create index if not exists "IDX_loyalty_transaction_account_order_type" ' +
        'on "loyalty_transaction" ("account_id", "order_id", "type") ' +
        'where "order_id" is not null;',
    )

    this.addSql(
      'alter table "loyalty_transaction" add constraint ' +
        '"loyalty_transaction_account_id_foreign" ' +
        'foreign key ("account_id") references "loyalty_account" ("id") ' +
        'on update cascade on delete cascade;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "loyalty_transaction" cascade;')
    this.addSql('drop table if exists "loyalty_account" cascade;')
  }
}
