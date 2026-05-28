import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260528000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "preorder_token" (' +
        '"id" text not null, ' +
        '"token_hash" text not null, ' +
        '"expires_at" timestamptz null, ' +
        '"last_used_at" timestamptz null, ' +
        '"revoked_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_token_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "preorder_token_hash_unique" on "preorder_token" ("token_hash") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "preorder_token" cascade;')
  }
}
