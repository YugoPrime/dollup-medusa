/**
 * Local SHEIN quote-scrape daemon — runs on the laptop, NOT Coolify.
 *
 * SHEIN serves a JS captcha (/risk/challenge) to every plain fetch, so quotes
 * can only be produced by a real browser. This script polls the prod DB for
 * pending quote jobs, scrapes each in Playwright Chromium, prices via the
 * preorder pricing engine, and writes the result back.
 *
 * Run:  yarn medusa exec ./src/scripts/scrape-quote-jobs.ts
 * Env flags (medusa exec strips CLI args):
 *   QUOTE_SCRAPE_LIMIT   jobs claimed per tick (default 5)
 * Required env: DATABASE_URL etc. via .env.local-render (prod DB over tunnel).
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PREORDER_MODULE } from "../modules/preorder"
import type PreorderModuleService from "../modules/preorder/service"
import { PlaywrightSheinFetcher, classifyFetchOutcome } from "../lib/shein-fetcher"
import { buildQuotePayload } from "../lib/shein-scrape"
import { sendTelegram } from "../lib/telegram"

const MAX_ATTEMPTS = 3

export default async function scrapeQuoteJobs({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const limit = Number(process.env.QUOTE_SCRAPE_LIMIT ?? 5)
  const fetcher = new PlaywrightSheinFetcher()

  try {
    await svc.recordDaemonHeartbeat()
    const jobs = await svc.listQuoteJobs({ status: "pending", limit })
    logger.info(`[quote-scrape] ${jobs.length} pending job(s)`)

    for (const job of jobs) {
      const claimed = await svc.claimQuoteJob(job.id)
      if (!claimed) continue
      try {
        const raw = await fetcher.fetchPdp(job.shein_url)
        const outcome = classifyFetchOutcome(raw)

        if (outcome.kind === "removed") {
          await svc.recordScrapeResult(job.id, { outcome: "failed", last_error_kind: "removed" })
          continue
        }

        if (outcome.kind === "challenge" || outcome.kind === "parse-fail") {
          // claimQuoteJob already bumped attempts. Once the budget is spent,
          // give up to manual; otherwise return to the pending pool for retry.
          if (job.attempts >= MAX_ATTEMPTS) {
            await svc.recordScrapeResult(job.id, {
              outcome: "needs_manual",
              last_error_kind: outcome.kind,
            })
          } else {
            await svc.requeueQuoteJob(job.id)
          }
          continue
        }

        // ok -> parse + price
        const settings = await svc.getSettings()
        const payload = await buildQuotePayload(raw.html, {
          previewPrice: (usd: number) => svc.previewPrice({ sheinPriceUsd: usd }),
          settingsSnapshot: settings,
        })
        await svc.recordScrapeResult(job.id, payload)
        logger.info(`[quote-scrape] ${job.id} -> ${payload.outcome}`)
      } catch (err: any) {
        await svc.recordScrapeResult(job.id, {
          outcome: "needs_manual",
          last_error_kind: "network-error",
        })
        logger.warn(`[quote-scrape] ${job.id} errored: ${err?.message ?? err}`)
      }
    }
  } catch (err: any) {
    await sendTelegram(`❌ quote-scrape daemon tick failed: ${err?.message ?? err}`)
    throw err
  } finally {
    await fetcher.close()
  }
}
