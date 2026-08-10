/**
 * Inbound chat message → AI concierge.
 *
 * Runs off the Redis event bus rather than inline in the HTTP request so the
 * widget's POST returns immediately, and so Messenger/Instagram/WhatsApp reach
 * the same entry point later with no changes here.
 */
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework/subscribers"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { AI_AGENT_MODULE } from "../modules/ai-agent"
import type AiAgentModuleService from "../modules/ai-agent/service"
import { CHAT_MODULE } from "../modules/chat"
import type ChatModuleService from "../modules/chat/service"
import { evaluateGuards } from "../modules/ai-agent/lib/guards"
import { matchesHardTrigger, shouldEscalate } from "../modules/ai-agent/lib/escalation"
import { buildSystemBlocks } from "../modules/ai-agent/lib/prompt"
import { runAgent } from "../modules/ai-agent/lib/run"
import { AGENT_MODEL } from "../modules/ai-agent/lib/anthropic"
import { sendTelegram, escapeTelegramHtml } from "../lib/telegram"

const HISTORY_TURNS = 20
const HOLDING_LINE_COOLDOWN_MS = 6 * 60 * 60 * 1000
const HOLDING_LINES: Record<string, string> = {
  fr: "Je passe ça à l'équipe — on revient vers vous très vite.",
  en: "Let me pass this to the team — we'll get back to you very soon.",
  kreol: "Mo pe pass sa ar lekip la — nou pou revini ver ou byento.",
  mixed: "Je passe ça à l'équipe — on revient vers vous très vite.",
}
const INBOX_URL = "https://admin.dollupboutique.com/inbox"

type HistoryRow = {
  sender_kind: string
  body: string | null
  direction: string
  created_at: Date | string
}

/**
 * Fragile by construction: "was a holding line already sent recently" is
 * decided by comparing a message's body against the exact HOLDING_LINES
 * constants. chat_message has no metadata column to stamp a real marker on,
 * so this is the least-bad option available — but it silently stops working
 * the moment a holding line is reworded (the old row it's meant to match
 * against no longer equals any current HOLDING_LINES value). Revisit if a
 * metadata column is ever added to chat_message.
 */
function wasHoldingLineSentRecently(
  rows: HistoryRow[],
  cooldownMs: number,
  now: number,
): boolean {
  return rows.some(
    (m) =>
      m.sender_kind === "ai" &&
      typeof m.body === "string" &&
      Object.values(HOLDING_LINES).includes(m.body) &&
      now - new Date(m.created_at).getTime() < cooldownMs,
  )
}

/**
 * Persists exactly one AgentRun row and never throws. This is the only audit
 * trail the feature has — if the write itself fails (DB unreachable, bad
 * payload), that must be visible in the logs at error level rather than
 * silently dropped, but it must never take down the subscriber.
 */
async function persistAgentRun(
  agent: AiAgentModuleService,
  logger: Logger,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await agent.createAgentRuns(payload as never)
  } catch (err) {
    logger.error(
      `[ai-agent] FAILED TO WRITE AgentRun row for message ${payload.message_id} ` +
        `(intended status: ${payload.status}): ${(err as Error).message}`,
    )
  }
}

export default async function aiAgentOnInboundMessage({
  event,
  container,
}: SubscriberArgs<{ message_id: string; thread_id: string }>) {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const messageId = event.data?.message_id
  const threadId = event.data?.thread_id
  if (!messageId || !threadId) return

  // Hard env kill switch, checked before anything else so it works even when
  // the DB is unreachable.
  if (process.env.AI_AGENT_ENABLED !== "true") return

  // The subscriber must never let a failure escape into the event bus (it would
  // just retry and reprocess the same message). Every branch below that can
  // throw is inside this try, and the one thing that must NOT be silently
  // swallowed — a failure to write the AgentRun audit row — is logged at error
  // level from persistAgentRun before this catch ever sees it.
  try {
    const chat = container.resolve<ChatModuleService>(CHAT_MODULE)
    const agent = container.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
    const locking = container.resolve(Modules.LOCKING)

    // One run at a time per thread: two fast messages must not produce two
    // overlapping runs that both reply.
    await locking.execute(
      `ai-agent:${threadId}`,
      async () => {
        let message: any
        let thread: any
        try {
          ;[message] = await chat.listMessages({ id: messageId })
          ;[thread] = await chat.listThreads({ id: threadId })
        } catch (err) {
          // Couldn't even fetch the message/thread — nothing downstream ran,
          // so nothing downstream had a chance to persist a row either. This
          // is the one branch with no thread to read a channel off of.
          await persistAgentRun(agent, logger, {
            thread_id: threadId,
            message_id: messageId,
            channel: "unknown",
            status: "failed",
            error: (err as Error).message,
          })
          return
        }
        if (!message || !thread) {
          // Not an error — the row genuinely doesn't exist (deleted, stale
          // event). Still worth a row: without one, this looks in
          // ai_agent_run identical to the message never having arrived.
          await persistAgentRun(agent, logger, {
            thread_id: threadId,
            message_id: messageId,
            channel: thread?.channel ?? "unknown",
            status: "skipped",
            skip_reason: "message_missing",
          })
          return
        }

        // Everything from here down that can throw for reasons unrelated to
        // the agent's own judgement (a DB hiccup fetching settings, knowledge,
        // or history) is wrapped so it still lands an AgentRun row instead of
        // vanishing into the outer catch's plain log line. Once runAgent has
        // actually returned, every step below already persists its own row
        // and never rethrows (see the delivery try/catch and persistAgentRun
        // itself) — so in practice this catch is only ever reached by a
        // pre-run failure.
        try {
          // Idempotency. The lock this callback runs inside only prevents
          // *concurrent* runs on this thread — it says nothing about this
          // exact message being processed again LATER, e.g. if the event bus
          // redelivers message_id after a crash between a successful send and
          // the job's ack. That is a different problem from the lock's, and
          // the next reader should not assume the lock already covers it.
          // ai_agent_run doubles as the marker that closes it: if this
          // message already produced a terminal, customer-facing outcome,
          // don't run — and don't reply — a second time. "skipped"/"failed"
          // runs are left alone so a genuine retry (guard said no, or
          // delivery broke) can still go through.
          const priorRuns = (await agent.listAgentRuns({ message_id: messageId })) as Array<{
            status: string
          }>
          if (priorRuns.some((r) => r.status === "replied" || r.status === "escalated")) {
            return
          }

          const settings = await agent.getSettings()
          const guard = evaluateGuards({
            settings: settings as never,
            thread: thread as never,
            message: message as never,
            now: new Date(),
          })

          if (!guard.run) {
            await persistAgentRun(agent, logger, {
              thread_id: threadId,
              message_id: messageId,
              channel: (thread as any).channel,
              status: "skipped",
              skip_reason: guard.skipReason,
            })
            return
          }

          // Assemble the cached prefix + the last N turns of this thread.
          const entries = await agent.listKnowledgeEntries({ is_active: true })
          const systemBlocks = buildSystemBlocks(entries as never)
          const rows = (await chat.listMessages(
            { thread_id: threadId },
            { order: { created_at: "DESC" }, take: HISTORY_TURNS },
          )) as HistoryRow[]
          const history = rows
            .slice()
            .reverse()
            .filter((m) => typeof m.body === "string" && m.body.trim())
            .map((m) => ({
              role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
              content: m.body as string,
            }))

          // runAgent never throws — every failure inside it (bad key, timeout,
          // network error, malformed terminal call) is captured into
          // outcome.error / outcome.terminal so it always reaches the
          // escalation decision and the audit row below.
          const outcome = await runAgent({ scope: container, systemBlocks, history })

          const hardTrigger = matchesHardTrigger((message as any).body ?? "")
          const decision = shouldEscalate({
            confidence: outcome.reply?.confidence ?? null,
            threshold: Number(settings.confidence_threshold ?? 0.7),
            toolEscalated: outcome.terminal === "escalate",
            hardTrigger,
            errored: outcome.terminal === "timeout" || outcome.error !== null,
          })

          const shadow = settings.mode === "shadow"

          // The run itself already succeeded (outcome exists) by this point.
          // Everything from here down is delivery: sending the reply, storing
          // the draft, or escalating. A failure here must not erase the run —
          // it must be recorded as status "failed" with the error attached,
          // never lost. runStatus/runError below are what actually gets
          // persisted; they start optimistic and are downgraded on failure.
          let runStatus: "replied" | "escalated" | "failed" = decision.escalate
            ? "escalated"
            : "replied"
          let runError = outcome.error

          let spend: {
            spend_usd_micros: number
            crossed70: boolean
            exhausted: boolean
          } | null = null
          try {
            spend = await agent.addSpend(outcome.costMicros)
          } catch (err) {
            logger.error(
              `[ai-agent] addSpend failed for thread ${threadId}: ${(err as Error).message}`,
            )
          }

          try {
            if (decision.escalate) {
              await chat.updateThreads({ id: threadId, needs_human: true } as never)

              // One holding line per thread per 6h, and never in shadow mode —
              // shadow mode must not put a single word in front of a customer.
              if (!shadow) {
                const already = wasHoldingLineSentRecently(
                  rows,
                  HOLDING_LINE_COOLDOWN_MS,
                  Date.now(),
                )
                if (!already) {
                  const lang = outcome.reply?.language ?? "fr"
                  await chat.sendOutbound({
                    threadId,
                    body: HOLDING_LINES[lang] ?? HOLDING_LINES.fr,
                    senderKind: "ai",
                  })
                }
              }
            } else if (outcome.reply) {
              if (shadow) {
                // Shadow mode: keep the draft on the inbound message for review.
                // Never sent to the customer — the widget only ever renders
                // direction/sender_kind/body, not draft_reply.
                await chat.updateMessages({
                  id: messageId,
                  draft_reply: { text: outcome.reply.text, intent: outcome.reply.intent },
                  draft_confidence: outcome.reply.confidence,
                } as never)
              } else {
                await chat.sendOutbound({ threadId, body: outcome.reply.text, senderKind: "ai" })
              }
            }
          } catch (err) {
            runStatus = "failed"
            const deliveryError = (err as Error).message
            runError = runError ? `${runError}; delivery failed: ${deliveryError}` : deliveryError
            logger.error(
              `[ai-agent] reply delivery failed for thread ${threadId}, message ${messageId}: ${deliveryError}`,
            )

            // Unlike the escalate branch (which already set needs_human before
            // even attempting the holding line, and always pages Telegram
            // below), a failed send on the DIRECT reply path had nothing else
            // flagging it — the customer would otherwise be left with no
            // answer and no trace beyond a row in a table nobody watches live.
            // Make a failed send at least as visible as an escalation.
            if (!decision.escalate && !shadow) {
              try {
                await chat.updateThreads({ id: threadId, needs_human: true } as never)
              } catch (threadErr) {
                logger.error(
                  `[ai-agent] failed to flag thread ${threadId} needs_human after delivery failure: ${(threadErr as Error).message}`,
                )
              }
              await sendTelegram(
                [
                  `🆘 <b>Chat — envoi échoué, un humain est demandé</b>`,
                  "",
                  `Canal : ${(thread as any).channel}`,
                  `Raison : échec d'envoi (pas un choix du modèle) — ${escapeTelegramHtml(deliveryError)}`,
                  "",
                  `<a href="${INBOX_URL}">Ouvrir l'inbox</a>`,
                ].join("\n"),
              )
            }
          }

          // Persisted regardless of what happened above — this call cannot be
          // skipped by any earlier throw, and persistAgentRun itself never
          // throws.
          await persistAgentRun(agent, logger, {
            thread_id: threadId,
            message_id: messageId,
            channel: (thread as any).channel,
            status: runStatus,
            intent: outcome.reply?.intent ?? null,
            confidence: outcome.reply?.confidence ?? null,
            escalation_reason: decision.reason,
            language: outcome.reply?.language ?? null,
            tools_used: outcome.toolsUsed,
            model: AGENT_MODEL,
            input_tokens: outcome.usage.input_tokens,
            output_tokens: outcome.usage.output_tokens,
            cache_read_input_tokens: outcome.usage.cache_read_input_tokens,
            cost_usd_micros: outcome.costMicros,
            latency_ms: outcome.latencyMs,
            error: runError,
          })

          // Telegram from here down: internal staff notifications only, never
          // customer-facing, so they are safe in shadow mode and safe to fire
          // after everything above. sendTelegram never throws (dormant/soft-fails
          // when unconfigured, and now internally timeboxed to 10s), and the
          // customer's reply/holding-line send above has already completed by
          // this point — notifying staff never blocks or races the
          // customer-facing send.
          if (decision.escalate) {
            const preview = String((message as any).body ?? "").slice(0, 200)
            await sendTelegram(
              [
                `🆘 <b>Chat — un humain est demandé</b>`,
                "",
                `Canal : ${(thread as any).channel}`,
                `Raison : ${escapeTelegramHtml(decision.reason ?? "—")}`,
                "",
                `Message : ${escapeTelegramHtml(preview)}`,
                "",
                `<a href="${INBOX_URL}">Ouvrir l'inbox</a>`,
              ].join("\n"),
            )
          }

          if (spend?.crossed70) {
            await sendTelegram(
              `⚠️ <b>Budget IA à 70 %</b>\nDépensé : $${(spend.spend_usd_micros / 1_000_000).toFixed(2)} sur $${(settings.monthly_budget_usd_micros / 1_000_000).toFixed(2)} ce mois-ci.`,
            )
          }
          if (spend?.exhausted) {
            await sendTelegram(
              `🛑 <b>Budget IA épuisé</b>\nL'agent est en pause jusqu'au mois prochain. L'inbox continue de fonctionner normalement.`,
            )
          }
        } catch (err) {
          // Reached only by a pre-run failure (idempotency check, settings,
          // knowledge, or history) — runAgent was never called, so none of
          // the persistAgentRun calls above ran either.
          await persistAgentRun(agent, logger, {
            thread_id: threadId,
            message_id: messageId,
            channel: (thread as any).channel,
            status: "failed",
            error: (err as Error).message,
          })
        }
      },
      // Give the lock more room than the agent's own 30s wall clock.
      { timeout: 45 },
    )
  } catch (err) {
    logger.error(
      `[ai-agent] inbound message ${messageId} (thread ${threadId}) failed: ${(err as Error).message}`,
    )
  }
}

export const config: SubscriberConfig = {
  event: "chat.message.received",
  context: { subscriberId: "ai-agent-on-inbound-message" },
}
