# AI Concierge — rollout runbook

This is the guide for turning on the AI chat assistant on the Doll Up
Boutique website. Read it fully before touching any environment variable
in Coolify — the first section below (pre-deploy steps) is not optional,
and skipping it will break the site's chat widget, not just the AI part.

## a) What exists and what does not

**Built and ready to deploy:**
- A chat widget on the website (`dollupboutique.com`) where a visitor can
  start a conversation.
- An AI assistant ("the agent") that can read that conversation and reply —
  it can look up product prices and stock, look up an existing order's
  status (only if the customer gives both the order number *and* the phone
  number on file), answer policy questions (shipping, returns, opening
  hours — whatever you've entered into the knowledge base), and hand off to
  a human when it's unsure or the conversation needs a person.

**Not built — do not assume any of this exists:**
- Instagram DMs and WhatsApp are **not** wired to the AI. The chat module
  can technically carry Messenger conversations (that's the existing human
  inbox), but the AI only ever looks at `web` (website widget) conversations.
  Turning the AI on has **zero effect** on Messenger/Instagram/WhatsApp.
- The AI cannot place, modify, or cancel an order. It can only *look up* an
  order that already exists.
- The AI cannot issue refunds, discounts, or promo codes — it's built to
  refuse and hand off to a human whenever a customer asks for one.

In short: turning this on changes what happens on the website's chat
bubble only. Nothing else on the site or in your other channels changes.

## b) BLOCKING pre-deploy steps

These come first because **nothing below this section will work** without
them. Do these before you touch any Coolify environment variable.

### b.1 — Database migrations do not exist yet

This whole feature was built without a database connected (there wasn't
one available while building it), so the code that describes the new
database columns and tables was written, but the actual instruction files
that create them ("migrations") were never generated. This is different
from a normal deploy: normally, migration files are already committed and
the server just runs them on startup. Here, the files don't exist at all.

What changed and needs a migration:
- The existing conversations table (`chat`) gained a new channel value
  (`web`, for the website widget) and two new columns
  (`ai_paused_until`, `needs_human`).
- Three brand-new tables were added: `ai_agent_run` (a log of every AI
  reply attempt), `ai_knowledge_entry` (your policy answers), and
  `ai_agent_setting` (the on/off switch and budget).

**Before deploying**, with a real database connection available (staging
or prod), run, in this exact order:

```bash
corepack yarn medusa db:generate chat
corepack yarn medusa db:generate ai_agent
corepack yarn medusa db:migrate
```

The two `db:generate` commands write new migration files into the repo —
commit and push those files. `db:migrate` then applies them. Your
container already runs `yarn medusa db:migrate` on every boot (see the
main `CLAUDE.md`), but that step only applies migration files that
already exist — it will not create them. If you deploy the code without
running `db:generate` first, `db:migrate` on boot has nothing new to
apply, and the columns/tables described above simply won't exist.

**What that failure looks like:** the website's chat widget breaks
immediately — not just the AI. The first message a visitor sends will
fail with a database error (something like "column ai_paused_until does
not exist" or "relation ai_agent_setting does not exist"), because even a
human-only conversation now needs those new columns. The two new AI pages
in `dollup-admin` (Settings → AI, Settings → AI → Knowledge) will also
fail to load. If you see either of those symptoms right after a deploy,
this is almost certainly why — go run the three commands above.

### b.2 — Test suites that were written but never run

Several automated test files were written for this feature but could not
be run during the build, because there was no database or Anthropic API
key available in that environment. They are not proof the feature works —
they're unverified. Run them once you have a database, **before**
flipping anything on for real customers:

```bash
corepack yarn test:integration:modules
```
Covers `src/modules/chat/__tests__/web-channel.spec.ts` (the new `web`
channel on the chat module) and
`src/modules/ai-agent/__tests__/settings.spec.ts` (the settings/knowledge
module logic).

```bash
corepack yarn test:integration:http
```
Covers `integration-tests/http/store-chat.spec.ts` — the actual HTTP
routes the storefront widget calls.

**If the HTTP suite fails, read the failure closely before concluding the
chat routes are broken.** That file's setup step (`beforeAll`) creates a
test user and a publishable API key before any of the 10 real test cases
run. That bootstrap step is the single most likely thing to fail first —
if it does, all 10 tests fail together, and the cause is almost always the
bootstrap (a user or key that couldn't be created), not the chat routes
themselves.

## c) Environment variables

**Backend** (`dollup-medusa`, Coolify app → `api.dollupboutique.com`):

| Variable | Secret? | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | The Claude API key. Without it, the AI can't run at all — it fails safe (times out and hands the conversation to a human), it doesn't crash the site. |
| `AI_AGENT_MODEL` | No | Which Claude model to use. Optional — defaults to `claude-sonnet-5` if left unset. |
| `AI_AGENT_ENABLED` | No | `true`/`false`. The hard kill switch for the whole AI feature — see section (f). |
| `STORE_CHAT_ENABLED` | No | `true`/`false`. Turns the website chat widget's backend routes on or off. Independent of the AI switch — you can have the widget on with a human-only inbox and the AI fully off. |

**Storefront** (`DUB-front`, Coolify app → `dollupboutique.com`):

| Variable | Secret? | What it does |
|---|---|---|
| `NEXT_PUBLIC_CHAT_WIDGET_ENABLED` | No (visible in the browser — `NEXT_PUBLIC_*` vars always are) | `true`/`false`. Shows or hides the chat bubble on the website. |
| `NEXT_PUBLIC_CHAT_POLL_OPEN_MS` | No | How often (milliseconds) the widget checks for new messages while a visitor has it open. Defaults to 3000 (3 seconds) if unset. |
| `NEXT_PUBLIC_CHAT_POLL_IDLE_MS` | No | Same, but while the widget is minimized. Defaults to 15000 (15 seconds) if unset. |

**Important:** Doll Up's Coolify apps do **not** auto-deploy on a code
push, and changing an environment variable also needs a manual redeploy
to take effect. Every step below that says "set X" needs a Coolify
redeploy of the relevant app afterward, or nothing changes.

## d) The staged rollout

Go through these in order. Do not skip ahead — each step is there because
skipping it either breaks something or removes your ability to catch a
mistake before a real customer sees it.

1. **Deploy with `AI_AGENT_ENABLED=false`, `STORE_CHAT_ENABLED=true`.**
   The widget is live but purely human — every message a visitor sends
   lands in `/inbox` in `dollup-admin`, and a staff reply there reaches
   the widget. Have a real person send a real message through the live
   widget and confirm it shows up in the inbox, and that a reply from the
   inbox reaches the widget. **Do not proceed to step 2 until this works
   with real traffic**, not just a local test.

2. **Seed the knowledge base.** Go to `dollup-admin` → Settings → AI →
   Knowledge and enter your real shipping, returns, opening-hours, and
   any other policy answers you want the AI able to quote. The AI can
   only answer from what's actually in there — an empty knowledge base
   means it will say "let me check" to almost everything.

3. **Turn the AI on in shadow mode.** Set `AI_AGENT_ENABLED=true` and, in
   `dollup-admin` → Settings → AI, set `enabled = true` and
   `mode = shadow`. In shadow mode the AI reads every conversation and
   writes a draft reply, but **no customer ever receives anything** —
   drafts only appear in `/inbox` for a human to review and send
   manually if they're good. Confirm this is really happening: watch
   `/inbox` for drafts appearing, and confirm no message goes out to a
   customer that a staff member didn't personally send.

4. **Review drafts for about a week.** Every miss — a wrong price, an
   awkward tone, a question it should have escalated but answered
   instead — should turn into either a new knowledge base entry or a new
   test case in the eval fixture (`src/scripts/agent-evals.json`), so the
   same mistake gets caught automatically next time.

5. **Run the eval gate before flipping to auto.**
   ```bash
   corepack yarn medusa exec ./src/scripts/run-agent-evals.ts
   ```
   This runs 30 realistic French/English/Kreol test conversations against
   the live model and checks the replies for known failure patterns
   (inventing a price, caving on a discount, replying in the wrong
   language, not escalating a refund/legal/damaged-item message). **Any
   line starting with `GUARDRAIL:` in the output means stop — do not turn
   on auto mode until it's fixed.** One thing to know going in: the
   eval's order-status test case uses a made-up order number and phone
   number, because there was no database to look up a real one while it
   was built. That case proves the lookup flow doesn't crash — it does
   **not** prove a real order status comes back correctly. Test that
   separately with one real order and its real phone number before
   trusting that part.

6. **Set `mode = auto`.** This is the point where the AI can reply to
   customers directly without a human in the loop. Watch spend (Settings
   → AI shows the running total against the monthly budget) and how often
   it hands off to a human, daily, for at least the first week.

## e) First-run checks — cannot be done until a database exists

These were flagged during the build as things that could not be verified
without a live database. Check all three **before** turning on shadow
mode (step 3 above), not after:

1. **Does product search actually filter by keyword?** The AI's product
   search tool asks the database for products matching what the customer
   typed. If that filtering is silently ignored by the underlying query,
   the AI gets back *every* product instead of matching ones, and will
   recommend or describe items completely unrelated to what the customer
   asked about. To check: ask the widget about a specific item ("do you
   have the black lace dress in stock?") and confirm the AI's reply
   actually reflects that item, not a grab-bag of unrelated products.

2. **Does the message-locking mechanism actually work at runtime?** This
   depends on Redis being configured (`REDIS_URL`), the same thing the
   event system already needs. `container.resolve(Modules.LOCKING)` in
   `src/subscribers/ai-agent-on-inbound-message.ts` runs outside the
   inner try/catch that persists an `AgentRun` row on failure — so if the
   locking module fails to resolve (Redis unreachable, misconfigured
   `REDIS_URL`/`LOCKING_REDIS_URL`), the agent doesn't double-reply, it
   **doesn't run at all**, silently. You get one `logger.error` line in
   the server logs and nothing else — no `AgentRun` row, no reply, no
   escalation, no visible symptom in the admin UI. This looks identical to
   the AI simply never being triggered, which makes it easy to mistake for
   a different, unrelated problem. Send two messages back-to-back in a
   quick test and confirm a reply comes back for each, in order — if
   nothing comes back for either, check the server logs for
   `[ai-agent] inbound message ... failed` before assuming something else
   is wrong.

3. **Is prompt caching actually working?** Sonnet 5 will not create a
   cache entry for a system prefix under roughly **1024 tokens** — this
   is a token floor, not a character count. Measure the actual prompt with
   `messages.count_tokens` (or the Anthropic console's token counter)
   **before** turning on shadow mode, not after — don't infer it from the
   runs table once money has already been spent. The repo's tripwire test
   (`src/modules/ai-agent/__tests__/prompt.unit.spec.ts`) asserts the
   built prompt is over 1024 **characters**, which is only a rough proxy
   for the token floor (roughly 500–650 tokens for 1759 characters of
   French) — it is a useful "did someone accidentally shrink the prompt"
   smoke test, but it is **not proof** the real prompt clears the actual
   1024-token floor. Once you have a real measurement, also watch it live:
   every AI reply is logged in a table you can see at `dollup-admin` →
   Settings → AI → Runs, including a column called
   `cache_read_input_tokens`. From the **second** reply onward in the same
   conversation thread, that number should be non-zero. If it stays at
   zero across multiple runs, caching is broken, and the real dollar cost
   will run at roughly **ten times** the budgeted figure — burning through
   a month's $22 budget in a matter of days instead of a month.

## f) How to stop it

- **`AI_AGENT_ENABLED=false` in the backend's Coolify environment,
  then redeploy the backend.** This is the hard kill switch. Within
  seconds of it taking effect, the widget's next check-in sees the AI as
  off and falls back to "our team will reply" — no storefront redeploy or
  code change needed, only the backend restart to pick up the new
  environment variable.
- **`enabled = false` in `dollup-admin` → Settings → AI** is the everyday
  control — a normal save in the admin, no Coolify access or redeploy
  needed at all. Use this for day-to-day pausing; use the Coolify switch
  above only if you need a kill switch that doesn't depend on the admin
  app being reachable.

## g) Known accepted risks

Stated here plainly so they're a decision you made, not a surprise you
find later:

- **Spend tracking can slightly under-count under heavy concurrent load.**
  The running total of what's been spent this month is updated by reading
  the current total and writing back a new one. If two AI replies finish
  at almost the exact same instant on two different customer
  conversations, one of those two updates can be lost, so the tracked
  total can run a little low. At today's volume (roughly 7 conversations
  a day) this is negligible. Revisit this once Instagram or WhatsApp are
  added and multiple AI conversations are routinely happening at once.
- **The $22/month budget is tight.** That figure is a ceiling based on
  Anthropic's full list price (not the cheaper promotional rate, which
  expires 2026-08-31), and covers roughly **200–250 conversations a
  month**. That's fine for the website alone at current traffic, but the
  budget is shared across every channel that ever uses this agent — once
  Instagram and WhatsApp are added, the same 200–250 conversations get
  used up much faster across all channels combined. Plan to raise
  `monthly_budget_usd_micros` (editable in `dollup-admin` → Settings → AI)
  before adding more channels, not after you notice replies have stopped.
