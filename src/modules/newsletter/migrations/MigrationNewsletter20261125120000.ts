import { Migration } from "@medusajs/framework/mikro-orm/migrations"

// Where the campaign's promo banner links to (null: the storefront home).
export class MigrationNewsletter20261125120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "newsletter_campaign" add column if not exists "banner_link" text null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "newsletter_campaign" drop column if exists "banner_link";')
  }
}
