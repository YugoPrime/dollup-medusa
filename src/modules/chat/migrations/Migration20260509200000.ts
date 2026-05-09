import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Initial schema for the chat module (unified inbox v1 foundation).
 *
 * Tables:
 *   chat_channel_account — connected WA/IG/Messenger page credentials (one row per connected page)
 *   chat_contact         — one row per (channel, external_id) pair; UNIQUE on that pair
 *   chat_thread          — one conversation thread per contact; UNIQUE on (channel, contact_id)
 *   chat_message         — individual messages; UNIQUE on external_id when non-null
 *
 * Intra-module FKs:
 *   chat_thread.contact_id → chat_contact.id (CASCADE)
 *   chat_message.thread_id → chat_thread.id (CASCADE)
 *
 * Cross-module links (to Medusa customer/order) go through Module Links — not raw FKs.
 */
export class Migration20260509200000 extends Migration {
  async up(): Promise<void> {
    // chat_channel_account
    this.addSql(
      'create table if not exists "chat_channel_account" (' +
        '"id" text not null, ' +
        '"channel" text check ("channel" in (\'whatsapp\', \'messenger\', \'instagram\')) not null, ' +
        '"external_id" text not null, ' +
        '"display_name" text not null, ' +
        '"access_token_enc" text not null, ' +
        '"webhook_verify_token" text not null, ' +
        '"is_active" boolean not null default true, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "chat_channel_account_pkey" primary key ("id"));',
    )

    // chat_contact
    this.addSql(
      'create table if not exists "chat_contact" (' +
        '"id" text not null, ' +
        '"channel" text check ("channel" in (\'whatsapp\', \'messenger\', \'instagram\')) not null, ' +
        '"external_id" text not null, ' +
        '"display_name" text null, ' +
        '"profile_pic_url" text null, ' +
        '"link_status" text check ("link_status" in (\'auto\', \'manual\', \'unknown\')) not null default \'unknown\', ' +
        '"last_seen_at" timestamptz null, ' +
        '"metadata" jsonb null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "chat_contact_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "IDX_chat_contact_channel_external_id" ' +
        'on "chat_contact" ("channel", "external_id") where "deleted_at" is null;',
    )

    // chat_thread
    this.addSql(
      'create table if not exists "chat_thread" (' +
        '"id" text not null, ' +
        '"channel" text check ("channel" in (\'whatsapp\', \'messenger\', \'instagram\')) not null, ' +
        '"contact_id" text not null, ' +
        '"status" text check ("status" in (\'open\', \'snoozed\', \'closed\')) not null default \'open\', ' +
        '"last_message_at" timestamptz null, ' +
        '"last_inbound_at" timestamptz null, ' +
        '"unread_count" integer not null default 0, ' +
        '"assignee_id" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "chat_thread_pkey" primary key ("id"), ' +
        'constraint "chat_thread_contact_id_fkey" foreign key ("contact_id") references "chat_contact" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create unique index if not exists "IDX_chat_thread_channel_contact_id" ' +
        'on "chat_thread" ("channel", "contact_id") where "deleted_at" is null;',
    )

    // chat_message
    this.addSql(
      'create table if not exists "chat_message" (' +
        '"id" text not null, ' +
        '"thread_id" text not null, ' +
        '"direction" text check ("direction" in (\'inbound\', \'outbound\')) not null, ' +
        '"external_id" text null, ' +
        '"sender_kind" text check ("sender_kind" in (\'customer\', \'staff\', \'ai\')) not null default \'customer\', ' +
        '"sender_user_id" text null, ' +
        '"body" text null, ' +
        '"attachments" jsonb null, ' +
        '"meta_status" text check ("meta_status" in (\'pending\', \'sent\', \'delivered\', \'read\', \'failed\')) not null default \'pending\', ' +
        '"meta_error" text null, ' +
        '"draft_reply" jsonb null, ' +
        '"draft_confidence" numeric null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "chat_message_pkey" primary key ("id"), ' +
        'constraint "chat_message_thread_id_fkey" foreign key ("thread_id") references "chat_thread" ("id") on update cascade on delete cascade);',
    )
    this.addSql(
      'create unique index if not exists "IDX_chat_message_external_id" ' +
        'on "chat_message" ("external_id") where "external_id" is not null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "chat_message" cascade;')
    this.addSql('drop table if exists "chat_thread" cascade;')
    this.addSql('drop table if exists "chat_contact" cascade;')
    this.addSql('drop table if exists "chat_channel_account" cascade;')
  }
}
