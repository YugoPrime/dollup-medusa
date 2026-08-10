# dollup-medusa — Doll Up Boutique backend

Medusa v2 commerce backend for Doll Up Boutique. Started from the official `medusa-starter-default`; lightly customized for Mauritius. Solo project, no CI.

See `../../CLAUDE.md` for the workspace overview and how this connects to the `DUB-front` Next.js storefront.

## Stack
- Medusa **2.13.1** (`@medusajs/medusa`, `@medusajs/framework`, `@medusajs/admin-sdk`, `@medusajs/cli`)
- Node >= 20, TypeScript 5.6, Jest for tests
- Yarn 4.12 (`.yarnrc.yml`, `.yarn/releases/`) — **use `yarn`, not `npm`**
- Postgres (via `DATABASE_URL`) + Redis (via `REDIS_URL`)
- Admin dashboard built into the same process; served at `/app`

## Repo & deploy
- GitHub: `YugoPrime/dollup-medusa`
- Deploy: Dockerfile → Coolify on `api.dollupboutique.com`
- `start.sh` runs `yarn medusa db:migrate` then `yarn start` on container boot — migrations happen on every deploy

## Env vars (`.env`, gitignored — see `.env.template`)
- `DATABASE_URL` — Postgres connection string (required, no fallback)
- `REDIS_URL` — Redis connection (event bus, workflows, cache)
- `STORE_CORS` — must include the storefront origin (`http://localhost:3000`, `https://shop.dollupboutique.com`, prod domain). **This is the #1 recurring bug source for the frontend** — see `DUB-front/CLAUDE.md` "CORS gotcha".
- `ADMIN_CORS`, `AUTH_CORS` — admin dashboard origins
- `JWT_SECRET`, `COOKIE_SECRET` — must be set in prod, not the `supersecret` fallback
- `DB_NAME` — used by Medusa CLI tooling

## Modules configured (`medusa-config.ts`)
- **Payment** — single provider: `pp_system_default` (Medusa's manual / COD provider). Frontend's checkout calls `payment.initiatePaymentSession(cart, { provider_id: "pp_system_default" })`.
- **Fulfillment** — single provider: `manual` (resolved as `manual_manual` when linking).
- No tax provider beyond core defaults, no notification provider (so no automatic order-confirmation emails — deferred feature).

## Mauritius config (`src/scripts/setup-shipping.ts`)
This script wires up the Mauritius region. **Hardcoded IDs** make it environment-specific and one-shot — re-running on a fresh DB will fail or produce duplicates:
- `REGION_ID = reg_01KN0AAX4FA592Q3HAY93W1AHV`
- `STOCK_LOCATION_ID = sloc_01KN48PYHQ0DTXXN2N0JWZSAYV`
- `SALES_CHANNEL_ID = sc_01KN07JKHRN9DP25TM5S664C5W`

Creates two shipping options in `mur`:
- Standard (3-5 jours): **0 MUR** (free)
- Express (1-2 jours): **15000** = MUR 150

If those IDs are stale or you're seeding a new env, the script needs editing first.

## ⚠️ `src/scripts/seed.ts` is the unmodified starter
It seeds **Europe** (eur/usd, GB/DE/DK/SE/FR/ES/IT) with Medusa demo products (T-Shirt, Sweatshirt, etc.). **Do not run on the live DB** — it'll create European regions and fake products. Only useful as a reference or for fresh dev environments.

## Project map
```
src/
├── admin/         # admin dashboard customizations (i18n only so far)
├── api/           # custom HTTP routes
│   ├── admin/custom/route.ts
│   └── store/custom/route.ts
├── jobs/          # scheduled jobs (empty)
├── links/         # cross-module remote links (empty)
├── modules/       # custom modules — chat, ai-agent (see "Custom modules" below)
├── scripts/
│   ├── seed.ts            # ⚠️ Europe demo seed — DO NOT run on prod
│   └── setup-shipping.ts  # Mauritius region wiring (hardcoded IDs)
├── subscribers/   # event subscribers — ai-agent-on-inbound-message.ts
└── workflows/     # custom workflows (empty)
```
The repo started as the starter + Mauritius shipping setup; `chat` and `ai-agent` are the first custom modules.

## Custom modules (`src/modules/`)
- **`chat`** — conversation threads and messages, channel-agnostic. Channels: Messenger (original) and `web` (new — the storefront's chat widget). The storefront talks to it through `POST /store/chat/sessions` and `POST /store/chat/messages`, gated by `STORE_CHAT_ENABLED`. Human replies go out through `/inbox` in `dollup-admin`.
- **`ai-agent`** — Claude-powered concierge that can draft or auto-send replies on `web`-channel threads. Gated by **both** `AI_AGENT_ENABLED` in the environment (hard kill switch) and the `enabled` flag on the settings row (everyday on/off, `dollup-admin` → Settings → AI). See `docs/AI-CONCIERGE-ROLLOUT.md` for the deploy runbook and `docs/superpowers/specs/2026-08-10-ai-concierge-website-widget-design.md` (workspace root, not this repo) for the design spec.

## Common commands
```
yarn dev                                # localhost:9000 (admin at /app)
yarn build                              # build server + admin
yarn start                              # production start
yarn medusa db:migrate                  # run migrations
yarn medusa exec ./src/scripts/seed.ts  # ⚠️ Europe demo data
yarn medusa exec ./src/scripts/setup-shipping.ts  # Mauritius shipping setup
yarn test:unit
yarn test:integration:http
yarn test:integration:modules
```

## Conventions / things to know
- **Read Medusa v2 docs before assuming APIs** — v2 (modules, workflows, container resolution) is very different from v1 and from generic ecommerce frameworks. The `@medusajs/framework/utils` `Modules.*` and `ContainerRegistrationKeys.*` enums are the right way to resolve services.
- Workflow imports come from `@medusajs/medusa/core-flows`. Custom workflows go in `src/workflows/` and are auto-registered.
- Custom routes are file-based: `src/api/store/foo/route.ts` exports `GET`, `POST`, etc.
- TypeScript output goes to `.medusa/server` (gitignored). Generated types live in `.medusa/types/` — referenced from `tsconfig.json` `include`.
- `instrumentation.ts` is the OTel hook — currently commented out. Uncomment when adding observability.
- Frontend SDK is **2.14.1**, backend is **2.13.1** — minor mismatch, fine in practice but worth bumping the backend at some point.

## Deferred / not configured
- Notification module (no order confirmation emails)
- File module beyond defaults (uploads currently local — won't survive Coolify redeploys; need S3/R2 module before relying on admin uploads)
- Tax provider (no real tax calculation)
- Custom workflows for any of: order status emails, low-stock alerts, customer welcome flow
- Stripe / real payment provider (currently COD-only)
