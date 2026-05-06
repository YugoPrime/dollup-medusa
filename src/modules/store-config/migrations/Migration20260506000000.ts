import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260506000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "email_settings" (' +
        '"id" text not null, ' +
        '"enabled_order_placed" boolean not null default true, ' +
        '"enabled_order_shipped" boolean not null default true, ' +
        '"enabled_welcome" boolean not null default true, ' +
        '"enabled_password_reset" boolean not null default true, ' +
        '"enabled_order_delivered" boolean not null default false, ' +
        '"from_email_mirror" text not null default \'\', ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "email_settings_pkey" primary key ("id"));',
    )
    this.addSql(
      'insert into "email_settings" (' +
        '"id", "enabled_order_placed", "enabled_order_shipped", ' +
        '"enabled_welcome", "enabled_password_reset", ' +
        '"enabled_order_delivered", "from_email_mirror"' +
        ") values (" +
        "'email_settings', true, true, true, true, false, ''" +
        ') on conflict ("id") do nothing;',
    )

    this.addSql(
      'create table if not exists "shipping_settings" (' +
        '"id" text not null, ' +
        '"free_shipping_threshold_mur" integer not null default 1500, ' +
        '"return_fee_mur" integer not null default 70, ' +
        '"preorder_eta_copy" text not null default \'Confirm before noon to receive your order the next day across Mauritius.\', ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "shipping_settings_pkey" primary key ("id"));',
    )
    this.addSql(
      'insert into "shipping_settings" (' +
        '"id", "free_shipping_threshold_mur", "return_fee_mur", "preorder_eta_copy"' +
        ") values (" +
        "'shipping_settings', 1500, 70, " +
        "'Confirm before noon to receive your order the next day across Mauritius.'" +
        ') on conflict ("id") do nothing;',
    )

    this.addSql(
      'create table if not exists "store_settings" (' +
        '"id" text not null, ' +
        '"contact_phone" text not null default \'+230 5941 6359\', ' +
        '"contact_email" text not null default \'hello@dollupboutique.com\', ' +
        '"contact_hours" text not null default \'Mon-Sat 09:00-18:00 (Mauritius time)\', ' +
        '"instagram_url" text not null default \'https://www.instagram.com/dollupboutique/\', ' +
        '"facebook_url" text not null default \'https://www.facebook.com/dollupboutique/\', ' +
        '"tiktok_url" text not null default \'https://www.tiktok.com/@dollupboutique\', ' +
        '"whatsapp_url" text not null default \'https://wa.me/23059416359\', ' +
        '"footer_copyright" text not null default \'Doll Up Boutique Limited. BRN C18159019 - VAT 27646277.\', ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "store_settings_pkey" primary key ("id"));',
    )
    this.addSql(
      'insert into "store_settings" (' +
        '"id", "contact_phone", "contact_email", "contact_hours", ' +
        '"instagram_url", "facebook_url", "tiktok_url", "whatsapp_url", ' +
        '"footer_copyright"' +
        ") values (" +
        "'store_settings', '+230 5941 6359', " +
        "'hello@dollupboutique.com', " +
        "'Mon-Sat 09:00-18:00 (Mauritius time)', " +
        "'https://www.instagram.com/dollupboutique/', " +
        "'https://www.facebook.com/dollupboutique/', " +
        "'https://www.tiktok.com/@dollupboutique', " +
        "'https://wa.me/23059416359', " +
        "'Doll Up Boutique Limited. BRN C18159019 - VAT 27646277.'" +
        ') on conflict ("id") do nothing;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "store_settings" cascade;')
    this.addSql('drop table if exists "shipping_settings" cascade;')
    this.addSql('drop table if exists "email_settings" cascade;')
  }
}
