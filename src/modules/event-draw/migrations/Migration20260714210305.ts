import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260714210305 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "event_settings" drop constraint if exists "event_settings_singleton_unique";`);
    this.addSql(`alter table if exists "event_reward" drop constraint if exists "event_reward_idempotency_key_unique";`);
    this.addSql(`alter table if exists "event_code" drop constraint if exists "event_code_code_unique";`);
    this.addSql(`create table if not exists "event_code" ("id" text not null, "code" text not null, "batch_id" text not null, "redeemed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_code_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_event_code_deleted_at" ON "event_code" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_event_code_code_unique" ON "event_code" ("code") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "event_draw_entry" ("id" text not null, "entry_id" text not null, "draw_period" text not null, "is_winner" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_draw_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_event_draw_entry_deleted_at" ON "event_draw_entry" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "event_entry" ("id" text not null, "code" text not null, "email" text not null, "phone" text not null, "consent" boolean not null default false, "spins_earned" integer not null default 1, "spins_used" integer not null default 0, "review_bonus_claimed" boolean not null default false, "social_bonus_claimed" boolean not null default false, "customer_id" text null, "ip" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_event_entry_deleted_at" ON "event_entry" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "event_reward" ("id" text not null, "entry_id" text not null, "slice" text not null, "type" text not null, "points" integer not null default 0, "status" text not null default 'issued', "idempotency_key" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_reward_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_event_reward_deleted_at" ON "event_reward" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_event_reward_idempotency_key_unique" ON "event_reward" ("idempotency_key") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "event_settings" ("id" text not null, "singleton" text not null default 'default', "weights_json" text not null, "active_draw_period" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "event_settings_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_event_settings_deleted_at" ON "event_settings" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_event_settings_singleton_unique" ON "event_settings" ("singleton") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "event_code" cascade;`);

    this.addSql(`drop table if exists "event_draw_entry" cascade;`);

    this.addSql(`drop table if exists "event_entry" cascade;`);

    this.addSql(`drop table if exists "event_reward" cascade;`);

    this.addSql(`drop table if exists "event_settings" cascade;`);
  }

}
