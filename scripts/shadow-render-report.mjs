// Read-only shadow render comparison: laptop (metadata.render) vs cloud
// (metadata.render_shadow) for one day's story plan. SELECTs only.
//
// Usage: node scripts/shadow-render-report.mjs --env <file with DATABASE_URL> --date YYYY-MM-DD

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const SLOW_MS = 240000

function hashOf(url) {
  if (typeof url !== "string" || !url) return "-"
  const name = url.split("?")[0].split("/").pop() ?? ""
  return name.replace(/\.mp4$/, "") || "-"
}

export function compareShadow(slots) {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index)
  const rows = sorted.map((s) => {
    const md = s.metadata ?? {}
    const laptop = hashOf(md.render?.mp4_url)
    const sh = md.render_shadow
    const shadow = sh?.state === "done" ? hashOf(sh.mp4_url) : "-"
    let result
    if (!sh || sh.state === "sent") result = "missing"
    else if (sh.state === "failed") result = "failed"
    else if (sh.state !== "done") result = "missing"
    else if (Number(sh.duration_ms) >= SLOW_MS) result = "slow"
    else if (laptop === "-") result = "no laptop render"
    else result = laptop === shadow ? "same" : "inputs differ"
    return { index: s.slot_index, laptop, shadow, result }
  })
  const bad = new Set(["missing", "failed", "slow"])
  let verdict = "PASS"
  if (rows.some((r) => bad.has(r.result))) verdict = "FAIL"
  else if (rows.some((r) => r.result === "inputs differ")) verdict = "CHECK"
  return { rows, verdict }
}

function loadEnv(file) {
  const out = {}
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const envFile = arg("env")
  const date = arg("date")
  if (!envFile || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    console.error("usage: shadow-render-report.mjs --env <file> --date YYYY-MM-DD")
    process.exit(2)
  }
  const databaseUrl = process.env.DATABASE_URL || loadEnv(envFile).DATABASE_URL
  if (!databaseUrl) {
    console.error("DATABASE_URL not set")
    process.exit(2)
  }
  const { default: pg } = await import("pg")
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 8000, ssl: false })
  let plan, slots
  try {
    await client.connect()
    await client.query("BEGIN READ ONLY")
    const p = await client.query(
      `SELECT id FROM story_plan
       WHERE (plan_date AT TIME ZONE 'Indian/Mauritius')::date = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [date]
    )
    plan = p.rows[0]
    if (plan) {
      const s = await client.query(
        `SELECT id, slot_index, metadata FROM story_slot
         WHERE plan_id = $1 AND deleted_at IS NULL ORDER BY slot_index`,
        [plan.id]
      )
      slots = s.rows
    }
    await client.query("ROLLBACK")
  } catch (err) {
    const msg = String(err.code || err.message || err.name).split(databaseUrl).join("<redacted>")
    console.error(`shadow-report: database error: ${msg}`)
    process.exit(1)
  } finally {
    await client.end().catch(() => {})
  }
  if (!plan) {
    console.error(`No story plan for ${date}`)
    process.exit(1)
  }
  const { rows, verdict } = compareShadow(slots)
  console.log(`Plan ${plan.id} (${date})`)
  console.log("slot  laptop            shadow            result")
  for (const r of rows) console.log(`${String(r.index).padEnd(5)} ${r.laptop.padEnd(17)} ${r.shadow.padEnd(17)} ${r.result}`)
  const urls = slots
    .map((s) => ({ i: s.slot_index, u: s.metadata?.render_shadow?.mp4_url }))
    .filter((x) => x.u)
  console.log("\nShadow MP4s:")
  if (urls.length === 0) console.log("  (none)")
  for (const x of urls) console.log(`  ${x.i}: ${x.u}`)
  console.log(`\nVerdict: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
