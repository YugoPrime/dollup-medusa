import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260614010000_create_feed_post extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "feed_post" (
        "id" text not null,
        "post_date" text not null,
        "product_id" text null,
        "product_snapshot" jsonb null,
        "image_urls" jsonb not null default '[]',
        "caption" text null,
        "status" text check ("status" in ('planned','posted','failed','skipped')) not null default 'planned',
        "ig_media_id" text null,
        "fb_post_id" text null,
        "error" text null,
        "attempt_count" integer not null default 0,
        "posted_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "feed_post_pkey" primary key ("id")
      );
    `)
    this.addSql(
      'create index if not exists "IDX_feed_post_post_date" on "feed_post" ("post_date") where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "IDX_feed_post_product_id" on "feed_post" ("product_id") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "feed_post" cascade;')
  }
}
