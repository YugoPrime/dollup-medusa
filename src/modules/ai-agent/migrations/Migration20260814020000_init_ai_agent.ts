import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Initial schema for the ai-agent module (AI concierge).
 *
 * Tables:
 *   ai_agent_run       — one row per reply attempt; the feature's only audit trail
 *   ai_knowledge_entry — the policy answers the agent is allowed to quote
 *   ai_agent_setting   — singleton row: on/off, mode, budget, running spend
 *
 * No cross-module FKs: ai_agent_run.thread_id / message_id point at the chat
 * module's tables, and Medusa modules do not share raw foreign keys.
 *
 * Column-type notes, because two of these are load-bearing:
 *
 * - `confidence` and `confidence_threshold` are `real`, not `integer`. They hold
 *   0..1 fractions and an integer column would round 0.7 to 1, which makes the
 *   `confidence < threshold` gate in lib/escalation.ts true for every reply —
 *   the agent would hand 100% of conversations to a human and look merely
 *   cautious rather than broken.
 *
 * - every *_usd_micros column is an integer count of micro-dollars, never a
 *   float and never cents: one run can cost a fraction of a cent. `integer`
 *   (not `bigint`) is deliberate — the pg driver returns bigint as a *string*,
 *   which would silently break the arithmetic in lib/spend.ts. The $22/month
 *   budget is 22,000,000 micros against an int4 ceiling of ~2.1 billion.
 */
export class Migration20260814020000 extends Migration {
  async up(): Promise<void> {
    // ai_agent_run
    this.addSql(
      'create table if not exists "ai_agent_run" (' +
        '"id" text not null, ' +
        '"thread_id" text not null, ' +
        '"message_id" text not null, ' +
        '"channel" text not null, ' +
        '"status" text check ("status" in (\'skipped\', \'replied\', \'escalated\', \'failed\')) not null, ' +
        '"skip_reason" text null, ' +
        '"intent" text null, ' +
        '"confidence" real null, ' +
        '"escalation_reason" text null, ' +
        '"language" text null, ' +
        '"tools_used" jsonb null, ' +
        '"model" text null, ' +
        '"input_tokens" integer not null default 0, ' +
        '"output_tokens" integer not null default 0, ' +
        '"cache_read_input_tokens" integer not null default 0, ' +
        '"cost_usd_micros" integer not null default 0, ' +
        '"latency_ms" integer not null default 0, ' +
        '"error" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "ai_agent_run_pkey" primary key ("id"));',
    )
    // Not declared on the model, added deliberately: the subscriber's
    // idempotency check reads this table by message_id on EVERY inbound
    // message, and the table grows one row per reply attempt forever.
    this.addSql(
      'create index if not exists "IDX_ai_agent_run_message_id" ' +
        'on "ai_agent_run" ("message_id");',
    )

    // ai_knowledge_entry
    this.addSql(
      'create table if not exists "ai_knowledge_entry" (' +
        '"id" text not null, ' +
        '"title" text not null, ' +
        '"body" text not null, ' +
        '"tags" jsonb null, ' +
        '"is_active" boolean not null default true, ' +
        '"updated_by" text null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "ai_knowledge_entry_pkey" primary key ("id"));',
    )

    // ai_agent_setting — singleton, id supplied by the service (AGENT_SETTING_ID)
    this.addSql(
      'create table if not exists "ai_agent_setting" (' +
        '"id" text not null, ' +
        '"enabled" boolean not null default false, ' +
        '"mode" text check ("mode" in (\'shadow\', \'auto\')) not null default \'shadow\', ' +
        '"channels_enabled" jsonb not null, ' +
        '"monthly_budget_usd_micros" integer not null default 22000000, ' +
        '"spend_period" text not null, ' +
        '"spend_usd_micros" integer not null default 0, ' +
        '"budget_alert_sent_at" timestamptz null, ' +
        '"confidence_threshold" real not null default 0.7, ' +
        '"takeover_pause_hours" integer not null default 12, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "ai_agent_setting_pkey" primary key ("id"));',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "ai_agent_setting" cascade;')
    this.addSql('drop table if exists "ai_knowledge_entry" cascade;')
    this.addSql('drop table if exists "ai_agent_run" cascade;')
  }
}
