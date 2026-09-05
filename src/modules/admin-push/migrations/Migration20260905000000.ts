import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Web Push subscriptions for the installed Doll Up Admin PWA. One row per
 * device; `endpoint` is the push-service URL and is unique. See
 * docs/superpowers/specs/2026-09-05-admin-pwa-push-design.md.
 */
export class Migration20260905000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "admin_push_subscription" (' +
        '"id" text not null, ' +
        '"endpoint" text not null, ' +
        '"p256dh" text not null, ' +
        '"auth" text not null, ' +
        '"username" text not null, ' +
        '"user_agent" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "admin_push_subscription_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "admin_push_subscription_endpoint_unique" ' +
        'on "admin_push_subscription" ("endpoint") where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "admin_push_subscription_username_idx" ' +
        'on "admin_push_subscription" ("username");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "admin_push_subscription" cascade;')
  }
}
