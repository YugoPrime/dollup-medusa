import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260531000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table if exists "sourcing_settings" ' +
        'add column if not exists "flat_add_mur" numeric(10,3) not null default 0;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table if exists "sourcing_settings" ' +
        'drop column if exists "flat_add_mur";',
    )
  }
}
