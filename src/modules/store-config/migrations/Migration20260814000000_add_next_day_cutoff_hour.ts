import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds the daily next-day-delivery cutoff to shipping settings.
 *
 * Replaces three hardcoded, disagreeing values (2pm on the FAQ, noon in the ETA
 * copy, 1pm actually enforced at checkout) with one stored hour that the copy,
 * the checkout rule and the AI concierge all read.
 *
 * The existing `preorder_eta_copy` default is rewritten in the same step: it is
 * the sentence that carried the old "before noon" promise, and leaving it would
 * reintroduce the drift this column exists to end. Rows the owner has edited by
 * hand are left alone — only the untouched default is replaced.
 */
export class Migration20260814000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "shipping_settings" ' +
        'add column if not exists "next_day_cutoff_hour" integer not null default 12;',
    )
    this.addSql(
      'update "shipping_settings" set "preorder_eta_copy" = ' +
        "'Order before noon for next-day delivery across Mauritius.' " +
        "where \"preorder_eta_copy\" = " +
        "'Confirm before noon to receive your order the next day across Mauritius.';",
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table if exists "shipping_settings" drop column if exists "next_day_cutoff_hour";',
    )
  }
}
