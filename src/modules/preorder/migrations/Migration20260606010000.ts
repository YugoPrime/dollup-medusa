import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260606010000 extends Migration {
  async up(): Promise<void> {
    // Add the parent FK that the original create-table migration omitted.
    // Guarded: skip if a constraint of this name already exists.
    this.addSql(`
      do $$ begin
        if not exists (
          select 1 from pg_constraint where conname = 'preorder_quote_item_request_id_foreign'
        ) then
          alter table "preorder_quote_item"
            add constraint "preorder_quote_item_request_id_foreign"
            foreign key ("request_id") references "preorder_quote_request" ("id")
            on update cascade on delete cascade;
        end if;
      end $$;
    `)
  }

  async down(): Promise<void> {
    this.addSql('alter table if exists "preorder_quote_item" drop constraint if exists "preorder_quote_item_request_id_foreign";')
  }
}
