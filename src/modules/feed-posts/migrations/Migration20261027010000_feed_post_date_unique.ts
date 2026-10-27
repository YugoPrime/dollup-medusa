import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * One grid post per Mauritius day. Several writers now plan dates (the daily
 * job, the Feed Planner's Replace, the keep-off-social switch, a settings
 * save); without this a race could leave two rows for a day and post twice.
 * Prod had no duplicate dates when this was added (2026-10-27).
 */
export class Migration20261027010000_feed_post_date_unique extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create unique index if not exists "IDX_feed_post_post_date_unique" on "feed_post" ("post_date") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "IDX_feed_post_post_date_unique";')
  }
}
