import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Resend webhook events for newsletter campaigns (results panel in dollup-admin).
export class MigrationNewsletter20261126120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "newsletter_event" (' +
        '"id" text not null, ' +
        '"svix_id" text not null, ' +
        '"campaign_id" text not null, ' +
        '"broadcast_id" text not null, ' +
        '"email_id" text not null, ' +
        '"type" text not null, ' +
        '"email" text null, ' +
        '"link" text null, ' +
        '"bounce_type" text null, ' +
        '"occurred_at" timestamptz not null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "newsletter_event_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_newsletter_event_svix_id_unique" on "newsletter_event" ("svix_id") where "deleted_at" is null;',
    )
    this.addSql(
      'create index if not exists "IDX_newsletter_event_campaign_id_type" on "newsletter_event" ("campaign_id", "type") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "newsletter_event" cascade;')
  }
}
