import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260509120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "supplier" (' +
        '"id" text not null, ' +
        '"name" text not null, ' +
        '"contact_handle" text null, ' +
        '"notes" text null, ' +
        '"archived_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "supplier_pkey" primary key ("id"));',
    )
    this.addSql(
      'create index if not exists "IDX_supplier_archived_at" on "supplier" ("archived_at");',
    )

    this.addSql(
      'create table if not exists "draft_order" (' +
        '"id" text not null, ' +
        '"supplier_id" text not null, ' +
        '"status" text not null default \'drafting\', ' +
        '"currency" text not null default \'USD\', ' +
        '"landed_cost_multiplier" numeric(5,3) not null default 1.500, ' +
        '"notes" text null, ' +
        '"paid_at" timestamptz null, ' +
        '"shipped_at" timestamptz null, ' +
        '"received_at" timestamptz null, ' +
        '"archived_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "draft_order_pkey" primary key ("id"), ' +
        'constraint "draft_order_supplier_fk" foreign key ("supplier_id") references "supplier" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create index if not exists "IDX_draft_order_status" on "draft_order" ("status");',
    )
    this.addSql(
      'create index if not exists "IDX_draft_order_supplier_id" on "draft_order" ("supplier_id");',
    )

    this.addSql(
      'create table if not exists "draft_item" (' +
        '"id" text not null, ' +
        '"draft_order_id" text not null, ' +
        '"source_url" text null, ' +
        '"source_type" text not null default \'manual\', ' +
        '"scraped_title" text null, ' +
        '"scraped_image_url" text null, ' +
        '"working_name" text null, ' +
        '"cost_usd" numeric(10,2) not null default 0, ' +
        '"notes" text null, ' +
        '"position" integer not null default 0, ' +
        '"uploaded_image_r2_key" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "draft_item_pkey" primary key ("id"), ' +
        'constraint "draft_item_draft_order_fk" foreign key ("draft_order_id") references "draft_order" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create index if not exists "IDX_draft_item_draft_order_id" on "draft_item" ("draft_order_id");',
    )

    this.addSql(
      'create table if not exists "draft_variant" (' +
        '"id" text not null, ' +
        '"draft_item_id" text not null, ' +
        '"color" text null, ' +
        '"size" text not null, ' +
        '"qty" integer not null default 0, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "draft_variant_pkey" primary key ("id"), ' +
        'constraint "draft_variant_draft_item_fk" foreign key ("draft_item_id") references "draft_item" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create unique index if not exists "IDX_draft_variant_unique_combo" ' +
        'on "draft_variant" ("draft_item_id", "color", "size") where "deleted_at" is null;',
    )

    this.addSql(
      'create table if not exists "draft_cost_history" (' +
        '"id" text not null, ' +
        '"draft_item_id" text not null, ' +
        '"old_cost_usd" numeric(10,2) not null, ' +
        '"new_cost_usd" numeric(10,2) not null, ' +
        '"reason" text not null, ' +
        '"changed_at" timestamptz not null default now(), ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "draft_cost_history_pkey" primary key ("id"), ' +
        'constraint "draft_cost_history_draft_item_fk" foreign key ("draft_item_id") references "draft_item" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create index if not exists "IDX_draft_cost_history_draft_item_id" on "draft_cost_history" ("draft_item_id");',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "draft_cost_history" cascade;')
    this.addSql('drop table if exists "draft_variant" cascade;')
    this.addSql('drop table if exists "draft_item" cascade;')
    this.addSql('drop table if exists "draft_order" cascade;')
    this.addSql('drop table if exists "supplier" cascade;')
  }
}
