import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Opens the chat module to the website widget (`web` channel) and adds the two
 * columns the AI concierge needs on a thread.
 *
 * Three things happen here:
 *
 * 1. `web` joins the channel enum. The enum is a CHECK constraint, and it lives
 *    on THREE tables, not one — chat_channel_account, chat_contact and
 *    chat_thread all declare `channel`. Missing any one of them means the first
 *    visitor message fails its insert, so the widget breaks for everyone even
 *    with the AI switched off.
 *
 *    The old constraints were created inline in Migration20260509200000, so
 *    Postgres named them itself. Rather than guess the generated names (a wrong
 *    guess makes `drop constraint if exists` a silent no-op and leaves the old
 *    constraint rejecting 'web'), each is looked up by the column it covers and
 *    dropped by its real name, then re-added under a known name.
 *
 * 2. chat_thread gains `ai_paused_until` (set when a human replies, to keep the
 *    agent quiet on that thread) and `needs_human` (set when the agent
 *    escalates; drives the /inbox "Needs human" filter).
 *
 * 3. chat_message.draft_confidence changes numeric -> real. The column has
 *    existed since May but nothing ever wrote it — shadow mode is the first
 *    thing to, and it writes fractions. `real` is what model.float() declares,
 *    and unlike `numeric` the pg driver returns it as a JS number rather than a
 *    string.
 */
const CHANNEL_TABLES = ["chat_channel_account", "chat_contact", "chat_thread"]

const CHANNELS_WITH_WEB = "'whatsapp', 'messenger', 'instagram', 'web'"
const CHANNELS_WITHOUT_WEB = "'whatsapp', 'messenger', 'instagram'"

/**
 * Drops every CHECK constraint covering `<table>.channel`, whatever Postgres
 * happened to name it. Matched on the constrained column via conkey, not on the
 * rendered constraint text — pg_get_constraintdef() does not always quote the
 * column name, so a text match is unreliable.
 */
function dropChannelChecks(table: string): string {
  return `
    do $$
    declare
      c record;
    begin
      for c in
        select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = current_schema()
          and rel.relname = '${table}'
          and con.contype = 'c'
          and con.conkey @> array[(
            select attnum from pg_attribute
            where attrelid = rel.oid and attname = 'channel' and not attisdropped
          )]::smallint[]
      loop
        execute format('alter table %I drop constraint %I', '${table}', c.conname);
      end loop;
    end
    $$;
  `
}

export class Migration20260814010000 extends Migration {
  async up(): Promise<void> {
    for (const table of CHANNEL_TABLES) {
      this.addSql(dropChannelChecks(table))
      this.addSql(
        `alter table "${table}" add constraint "${table}_channel_check" ` +
          `check ("channel" in (${CHANNELS_WITH_WEB}));`,
      )
    }

    this.addSql(
      'alter table if exists "chat_thread" ' +
        'add column if not exists "ai_paused_until" timestamptz null;',
    )
    this.addSql(
      'alter table if exists "chat_thread" ' +
        'add column if not exists "needs_human" boolean not null default false;',
    )

    this.addSql(
      'alter table if exists "chat_message" ' +
        'alter column "draft_confidence" type real using "draft_confidence"::real;',
    )
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table if exists "chat_message" ' +
        'alter column "draft_confidence" type numeric using "draft_confidence"::numeric;',
    )
    this.addSql('alter table if exists "chat_thread" drop column if exists "needs_human";')
    this.addSql('alter table if exists "chat_thread" drop column if exists "ai_paused_until";')

    // Deliberately fails if any 'web' row survives: narrowing the enum back
    // while web threads exist would leave rows violating their own constraint.
    // Delete the web rows first if you genuinely mean to revert this.
    for (const table of CHANNEL_TABLES) {
      this.addSql(dropChannelChecks(table))
      this.addSql(
        `alter table "${table}" add constraint "${table}_channel_check" ` +
          `check ("channel" in (${CHANNELS_WITHOUT_WEB}));`,
      )
    }
  }
}
