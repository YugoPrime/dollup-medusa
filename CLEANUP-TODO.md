# Doll Up Boutique Backend — Cleanup & Hardening TODO

Follow-up doc from the 2026-04-29 deploy-repair session. Backend (Medusa 2.13.1) was failing to boot on Coolify; this lists everything we noticed and didn't fix in that session, ordered by priority.

## Current state (post-fix, baseline for next session)

- Last good commit: `97e336a` on `master`
- Container boots cleanly, migrations are idempotent, server up on port 9000
- Storefront still uses `pp_system_default` — system payment provider now auto-registers with that ID (no manual entry needed)
- `src/scripts/check-ids.ts` exists, runs via `yarn medusa exec`
- 2026-04-29 cleanup pass completed local-code items below: Redis event/locking modules wired, Dockerfile install hardened, direct deps declared, starter seed moved out of the default path, shipping setup no longer uses hardcoded IDs, GitHub Actions build check added, and frontend Medusa SDK/types pinned to backend version.

## Session commits (for reference)

| SHA | What |
|-----|------|
| `86ffb4b` | Added `check-ids.ts` + project `CLAUDE.md` |
| `8d9a38f` | Removed broken `@medusajs/payment/providers/system` registration in `medusa-config.ts` (was causing `MODULE_NOT_FOUND` on every deploy since `db22c0c`) |
| `97e336a` | Fixed TS error in `check-ids.ts` — `listStockLocations` requires a selector arg |

---

## Done — 2026-04-29 local cleanup pass

### 1. Redis wired to event bus and locking modules

**Observed in startup logs:**
```
warn: Local Event Bus installed. This is not recommended for production.
info: Locking module: Using "in-memory" as default.
```

Status: **done in code**. `medusa-config.ts` now registers:

- `@medusajs/medusa/event-bus-redis`
- `@medusajs/medusa/locking` with `@medusajs/medusa/locking-redis`

It uses `EVENTS_REDIS_URL || REDIS_URL` for events and `LOCKING_REDIS_URL || REDIS_URL` for locking. Direct dependencies were added for `@medusajs/event-bus-redis`, `@medusajs/locking`, and `@medusajs/locking-redis` at `2.13.1`.

Remaining runtime check: redeploy with `REDIS_URL` present and confirm logs show Redis event/locking connections instead of local/in-memory fallbacks.

---

### 2. Dockerfile secret build args removed / verified

**Observed (3 warnings):**
```
SecretsUsedInArgOrEnv: ARG "AUTH_CORS"     (Dockerfile line 9)
SecretsUsedInArgOrEnv: ARG "COOKIE_SECRET" (line 4)
SecretsUsedInArgOrEnv: ARG "JWT_SECRET"    (line 7)
```

Status: **already resolved before this pass**. Current `Dockerfile` has no `ARG` entries for `AUTH_CORS`, `COOKIE_SECRET`, or `JWT_SECRET`.

Remaining Coolify check: keep `JWT_SECRET`, `COOKIE_SECRET`, and CORS env vars runtime-only; don't mark secrets "Available at Buildtime".

---

### 3. Dockerfile no longer persists build-only `NODE_ENV=development`

Coolify advisory:
```
Build-time NODE_ENV=production warning
Affects: Node.js/npm/yarn/bun/pnpm
Issue: Skips devDependencies installation...
```

Status: **partly done in code**. The admin build now uses one command-scoped env var:

```dockerfile
RUN NODE_ENV=development npx medusa build --admin-only
ENV NODE_ENV=production
```

Remaining Coolify check: uncheck "Available at Buildtime" on `NODE_ENV`. Runtime stays production through the Dockerfile.

---

### 4. Lockfile drift fallback removed

`Dockerfile:8`:
```dockerfile
RUN yarn install --immutable 2>/dev/null || yarn install
```

Status: **done**. Dockerfile now uses:

```dockerfile
RUN yarn install --immutable
```

---

### 5. Missing direct deps added in `package.json`

`@medusajs/payment` and `@medusajs/fulfillment-manual` are referenced from `medusa-config.ts` but only resolved transitively via `@medusajs/medusa`. Yarn 4 with `nodeLinker: node-modules` hoists them today, but any dep tree change could un-hoist them — same MODULE_NOT_FOUND class of bug we just fixed.

Status: **done**. Added both at `2.13.1`; lockfile updated.

Also pinned `packageManager` to `yarn@4.12.0`.

---

### 6. Starter `seed.ts` removed from default path

It's the unmodified Medusa starter — seeds **European** regions (eur/usd, GB/DE/DK/SE/FR/ES/IT) with demo products (T-Shirts, Sweatshirts). If anyone ever runs `yarn medusa exec ./src/scripts/seed.ts` against prod, you'll inject European garbage into the Mauritius store.

Status: **done**. Renamed to `src/scripts/_DO_NOT_RUN_starter-seed-europe.ts`, removed the default `seed` script, and added explicit scripts:

- `yarn setup:shipping`
- `yarn check:ids`
- `yarn seed:starter-dangerous`

---

### 7. Hardcoded IDs removed from `setup-shipping.ts`

```
REGION_ID = reg_01KN0AAX4FA592Q3HAY93W1AHV
STOCK_LOCATION_ID = sloc_01KN48PYHQ0DTXXN2N0JWZSAYV
SALES_CHANNEL_ID = sc_01KN07JKHRN9DP25TM5S664C5W
```

If any of these get recreated (DB reset, fresh dev env, accidental delete), the script becomes useless or worse. Refactor to look up by attribute:
- Region: `currency_code === "mur"` (Mauritius region)
- Stock location: by name (probably "European Warehouse" or whatever you named it)
- Sales channel: by name ("Default Sales Channel")

Status: **done**. Script now resolves:

- Region by `currency_code: "mur"`
- Stock location by `SETUP_SHIPPING_STOCK_LOCATION_NAME || "European Warehouse"`
- Sales channel by `SETUP_SHIPPING_SALES_CHANNEL_NAME || "Default Sales Channel"`

`check-ids.ts` was updated to validate the same lookup criteria.

---

### 8. GitHub Action build check added

`db22c0c` ("fix: add payment + fulfillment providers, shipping setup script") was authored by `root@srv1411338.hstgr.cloud` — someone SSH'd in and edited `medusa-config.ts` live. That's how the broken `@medusajs/payment/providers/system` import got in. The deploy never actually succeeded; the previous container kept running.

**Fix (process, not code):**
- Always work in a local checkout: edit → `yarn build` locally → push → Coolify deploys
- Add a basic GitHub Action that runs `yarn build` on every PR/push so TS errors get caught before Coolify even tries

Status: **partly done**. Added `.github/workflows/backend-build.yml` to run:

- `yarn install --immutable`
- `yarn build`

Remaining process rule: keep editing in local checkout, not over SSH on the Coolify server.

---

### 9. Frontend/backend Medusa version skew fixed

- Backend: Medusa **2.13.1**
- Frontend (`DUB-front/`): `@medusajs/js-sdk` **2.13.1**, `@medusajs/types` **2.13.1**

Status: **done**. Frontend SDK/types were pinned down to match the backend. `package-lock.json` was updated and `npm.cmd run build` passes.

Future upgrade note: when bumping backend Medusa, update `@medusajs/admin-sdk`, `@medusajs/cli`, `@medusajs/framework`, `@medusajs/medusa`, `@medusajs/test-utils`, frontend `@medusajs/js-sdk`, and frontend `@medusajs/types` together.

---

## Backlog (nice to have)

### 10. Notification provider — DONE 2026-05-09
Custom local module at `src/modules/notification-resend` ships emails via Resend on the `email` channel; `notification-local` retains the `feed` channel for the admin UI. Module gates on `RESEND_API_KEY` + `RESEND_FROM_EMAIL` env vars (optional `RESEND_FROM_NAME`, `RESEND_REPLY_TO`). Set both in Coolify to activate; otherwise the email channel silently no-ops. See `medusa-config.ts:96-128`.

### 11. R2 file storage provider — DONE 2026-05-09
`@medusajs/medusa/file` module wired in `medusa-config.ts` with conditional `@medusajs/medusa/file-s3` provider that uses Cloudflare R2 settings. Falls back to `file-local` when `R2_*` env vars are missing (so dev keeps working).

To activate in Coolify, set all five (server-only, NOT build-time):
- `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`
- `R2_BUCKET` — bucket name
- `R2_ACCESS_KEY_ID` — R2 access key
- `R2_SECRET_ACCESS_KEY` — R2 secret
- `R2_PUBLIC_URL` — `https://cdn.dollupboutique.com` (or your R2 public domain — must match the bucket's public URL)

Restart the Medusa container after setting. Verify by uploading a test image in admin → Products → it should resolve to the `R2_PUBLIC_URL` host, not localhost / container disk.

R2-specific notes: `region: "auto"`, `forcePathStyle: true` (R2 doesn't support virtual-host-style addressing on the workers domain). Same `@aws-sdk/client-s3` already used by `src/lib/sourcing/r2-upload.ts`.

### 12. No real tax provider
Mauritius has VAT (15%). Medusa core does flat-rate taxes via region settings, but if you need product-level tax categories, configure properly. Otherwise document explicitly that prices are tax-inclusive.

### 13. Stripe / real payment provider (when ready to take online payments)
Currently COD-only via auto-registered system provider. When ready, add to `medusa-config.ts` payment module's `options.providers` array (which we removed in `8d9a38f` — re-add with correct paths):

```ts
modules: [
  {
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [
        {
          resolve: "@medusajs/medusa/payment-stripe",
          id: "stripe",
          options: { apiKey: process.env.STRIPE_API_KEY },
        },
      ],
    },
  },
  // ...
]
```

The system provider keeps auto-registering even with a non-empty providers array — keeps COD as a fallback.

### 14. Observability disabled
`instrumentation.ts` exists but is commented out. Enable OpenTelemetry exports when traffic justifies — Honeycomb / Grafana Cloud / Axiom all have free tiers.

### 15. `@medusajs/draft-order` not configured — WON'T FIX
Logs show: `No link to load from /app/node_modules/@medusajs/draft-order/.medusa/server/src/links. skipped.`

Investigated 2026-05-09 — the package is a **transitive dep** of `@medusajs/medusa@2.13.1` (not listed in our `package.json`), so we can't `yarn remove` it without forking Medusa. The log line is the framework's module-discovery loader iterating `node_modules/@medusajs/*/.medusa/server/src/links` and skipping packages that don't ship a links directory. Benign — it's a `info`-level message, not an error, and doesn't block boot.

Options if it ever becomes worth silencing:
- Enable the module: add `{ resolve: "@medusajs/medusa/draft-order" }` to `medusa-config.ts` modules. Doll Up doesn't use draft orders (B2C COD-only), so this just adds a table for nothing.
- Wait for Medusa upstream to either ship the links dir empty or downgrade the log level.

Leaving as-is.

---

## When you start the next session

Tell the new agent:
> Read `Backend/dollup-medusa/CLEANUP-TODO.md` and `Backend/dollup-medusa/CLAUDE.md`. Pick one backlog item and fix it; don't batch.

Or hand it a specific item like:
> Configure a production file upload provider from `CLEANUP-TODO.md`, using S3 or Cloudflare R2.
