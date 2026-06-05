import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260606000000 extends Migration {
  async up(): Promise<void> {
    // settings: daemon heartbeat column
    this.addSql(
      'alter table if exists "preorder_settings" add column if not exists "shein_daemon_last_seen_at" timestamptz null;',
    )

    // request table
    this.addSql(
      'create table if not exists "preorder_quote_request" (' +
        '"id" text not null, ' +
        '"contact" jsonb not null, ' +
        `"status" text not null default 'pending', ` +
        '"notes" text null, ' +
        '"items_count" integer not null default 0, ' +
        '"client_ip" text null, ' +
        '"reserved_cart_id" text null, ' +
        '"expires_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_quote_request_pkey" primary key ("id"));',
    )

    // item table
    this.addSql(
      'create table if not exists "preorder_quote_item" (' +
        '"id" text not null, ' +
        '"request_id" text not null, ' +
        '"position" integer not null default 0, ' +
        '"shein_url" text not null, ' +
        `"status" text not null default 'pending', ` +
        '"attempts" integer not null default 0, ' +
        '"locked_at" timestamptz null, ' +
        '"last_attempt_at" timestamptz null, ' +
        '"last_error_kind" text null, ' +
        '"scraped_title" text null, ' +
        '"scraped_thumbnail" text null, ' +
        '"scraped_price_usd" numeric null, ' +
        '"color_options" jsonb null, ' +
        '"size_options" jsonb null, ' +
        '"all_in_price_mur" integer null, ' +
        '"price_breakdown" jsonb null, ' +
        '"fx_rate_used" numeric null, ' +
        '"settings_snapshot" jsonb null, ' +
        '"selected_size" text null, ' +
        '"selected_color" text null, ' +
        '"reserved_product_id" text null, ' +
        '"reserved_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_quote_item_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "preorder_quote_item_request_id" on "preorder_quote_item" ("request_id") where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "preorder_quote_item_status" on "preorder_quote_item" ("status") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "preorder_quote_item" cascade;')
    this.addSql('drop table if exists "preorder_quote_request" cascade;')
    this.addSql(
      'alter table if exists "preorder_settings" drop column if exists "shein_daemon_last_seen_at";',
    )
  }
}
