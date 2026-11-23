import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class MigrationNewsletter20261123120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "newsletter_subscriber" (' +
        '"id" text not null, ' +
        '"email" text not null, ' +
        '"list" text check ("list" in (\'main\', \'after_dark\')) not null, ' +
        '"source" text check ("source" in (\'footer\', \'after_dark_pdp\', \'checkout\', \'import\', \'admin\')) not null, ' +
        '"status" text check ("status" in (\'subscribed\', \'unsubscribed\')) not null default \'subscribed\', ' +
        '"subscribed_at" timestamptz not null, ' +
        '"unsubscribed_at" timestamptz null, ' +
        '"resend_contact_id" text null, ' +
        '"resend_synced_at" timestamptz null, ' +
        '"resend_sync_error" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "newsletter_subscriber_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_newsletter_subscriber_email_list_unique" on "newsletter_subscriber" ("email", "list") where "deleted_at" is null;',
    )
    this.addSql(
      'create table if not exists "newsletter_campaign" (' +
        '"id" text not null, ' +
        '"list" text check ("list" in (\'main\', \'after_dark\')) not null, ' +
        '"subject" text not null default \'\', ' +
        '"preheader" text null, ' +
        '"intro_text" text null, ' +
        '"banner_url" text null, ' +
        '"product_ids" jsonb not null, ' +
        '"status" text check ("status" in (\'draft\', \'sending\', \'sent\', \'failed\')) not null default \'draft\', ' +
        '"resend_broadcast_id" text null, ' +
        '"recipient_count" integer null, ' +
        '"sent_at" timestamptz null, ' +
        '"sent_by" text null, ' +
        '"error" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "newsletter_campaign_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "newsletter_campaign_created_at_idx" on "newsletter_campaign" ("created_at");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "newsletter_campaign" cascade;')
    this.addSql('drop table if exists "newsletter_subscriber" cascade;')
  }
}
