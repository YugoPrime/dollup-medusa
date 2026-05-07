import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Initial schema for the stories module: 4 tables + indexes.
 *
 *   story_plan        — one row per plan (UNIQUE on plan_date)
 *   story_slot        — N rows per plan (UNIQUE on plan_id+slot_index)
 *   publication_log   — anti-repeat ledger; survives plan deletion
 *   story_settings    — single-row config
 *
 * Cross-module FKs go through Module Links (not raw FKs) — none used here.
 * Intra-module FK: story_slot.plan_id → story_plan.id (CASCADE).
 * publication_log.slot_id → story_slot.id (SET NULL on delete).
 */
export class Migration20260507000000 extends Migration {
  async up(): Promise<void> {
    // story_plan
    this.addSql(
      'create table if not exists "story_plan" (' +
        '"id" text not null, ' +
        '"plan_date" date not null, ' +
        '"total_slots" integer not null, ' +
        '"category_distribution" jsonb not null, ' +
        '"scheduled_times" jsonb not null, ' +
        '"status" text not null default \'draft\', ' +
        '"notes" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "story_plan_pkey" primary key ("id"), ' +
        'constraint "story_plan_status_check" check ("status" in (\'draft\', \'active\', \'completed\')));',
    )
    this.addSql(
      'create unique index if not exists "IDX_story_plan_plan_date" ' +
        'on "story_plan" ("plan_date") where "deleted_at" is null;',
    )

    // story_slot
    this.addSql(
      'create table if not exists "story_slot" (' +
        '"id" text not null, ' +
        '"plan_id" text not null, ' +
        '"slot_index" integer not null, ' +
        '"scheduled_at" timestamptz not null, ' +
        '"category_id" text not null, ' +
        '"product_id" text null, ' +
        '"product_snapshot" jsonb null, ' +
        '"fallback_used" boolean not null default false, ' +
        '"posted_at" timestamptz null, ' +
        '"pick_attempt" integer not null default 1, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "story_slot_pkey" primary key ("id"), ' +
        'constraint "story_slot_plan_id_fkey" foreign key ("plan_id") references "story_plan" ("id") on delete cascade);',
    )
    this.addSql(
      'create unique index if not exists "IDX_story_slot_plan_index" ' +
        'on "story_slot" ("plan_id", "slot_index") where "deleted_at" is null;',
    )

    // publication_log
    this.addSql(
      'create table if not exists "publication_log" (' +
        '"id" text not null, ' +
        '"product_id" text not null, ' +
        '"slot_id" text null, ' +
        '"posted_at" timestamptz not null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "publication_log_pkey" primary key ("id"), ' +
        'constraint "publication_log_slot_id_fkey" foreign key ("slot_id") references "story_slot" ("id") on delete set null);',
    )
    this.addSql(
      'create index if not exists "IDX_publication_log_product_posted" ' +
        'on "publication_log" ("product_id", "posted_at" desc);',
    )
    this.addSql(
      'create index if not exists "IDX_publication_log_posted_at" ' +
        'on "publication_log" ("posted_at" desc);',
    )

    // story_settings
    this.addSql(
      'create table if not exists "story_settings" (' +
        '"id" text not null, ' +
        '"anti_repeat_days" integer not null default 7, ' +
        '"caption_template" text not null default \'{name} — Rs {price} · {sizes} · {link}\', ' +
        '"default_distribution" jsonb not null default \'[]\', ' +
        '"default_schedule" jsonb not null default \'[]\', ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "story_settings_pkey" primary key ("id"));',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "publication_log";')
    this.addSql('drop table if exists "story_slot";')
    this.addSql('drop table if exists "story_plan";')
    this.addSql('drop table if exists "story_settings";')
  }
}
