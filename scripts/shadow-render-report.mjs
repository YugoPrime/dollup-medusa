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

// A done shadow must sit exactly at its own output_key; an unparseable URL fails.
function urlMatchesKey(url, key) {
  if (typeof key !== "string" || !key) return false
  try {
    return new URL(url).pathname === "/" + key
  } catch {
    return false
  }
}

export function compareShadow(slots) {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index)
  const rows = sorted.map((s) => {
    const md = s.metadata ?? {}
    const laptop = hashOf(md.render?.mp4_url)
    const sh = md.render_shadow
    const shadow = sh?.state === "done" ? hashOf(sh.mp4_url) : "-"
    let result
    // Neither side rendered (e.g. a slot with no product): neutral, not a failure.
    if (laptop === "-" && !sh) result = "not rendered"
    else if (!sh || sh.state === "sent") result = "missing"
    else if (sh.state === "failed") result = "failed"
    else if (sh.state !== "done") result = "missing"
    else if (shadow === "-") result = "failed"
    else if (!urlMatchesKey(sh.mp4_url, sh.output_key)) result = "failed"
    else if (Number(sh.duration_ms) >= SLOW_MS) result = "slow"
    else if (laptop === "-") result = "no laptop render"
    else result = laptop === shadow ? "same" : "inputs differ"
    return { index: s.slot_index, laptop, shadow, result }
  })
  const bad = new Set(["missing", "failed", "slow"])
  // No row compared (all "not rendered", or no rows): FAIL, never a vacuous PASS.
  const compared = rows.some((r) => r.result !== "not rendered")
  let verdict = "PASS"
  if (!compared || rows.some((r) => bad.has(r.result))) verdict = "FAIL"
  else if (rows.some((r) => r.result === "inputs differ")) verdict = "CHECK"
  if (rows.length > 0 && !compared) {
    return { rows, verdict, reason: "Nothing was compared: no slot was rendered by either side." }
  }
  return { rows, verdict }
}

function loadEnv(file) {
  const out = {}
  let raw
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    console.error(`cannot read ${file}`)
    process.exit(1)
  }
  for (const line of raw.split(/\r?\n/)) {
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
  // The --env file is the only source; a shell DATABASE_URL (often the prod tunnel) is ignored.
  const databaseUrl = loadEnv(envFile).DATABASE_URL
  if (!databaseUrl) {
    console.error(`DATABASE_URL not found in ${envFile}`)
    process.exit(1)
  }
  let client, plan, slots
  try {
    const { default: pg } = await import("pg")
    client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 8000, ssl: false })
    await client.connect()
    await client.query("BEGIN READ ONLY")
    const p = await client.query(
      `SELECT id FROM story_plan
       WHERE plan_date = $1::date AND deleted_at IS NULL
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
    await client?.end().catch(() => {})
  }
  if (!plan) {
    console.error(`No story plan for ${date}`)
    process.exit(1)
  }
  if (slots.length === 0) console.log(`No slots in plan ${plan.id}`)
  const { rows, verdict, reason } = compareShadow(slots)
  console.log(`Plan ${plan.id} (${date})`)
  console.log("slot  laptop            shadow            result")
  for (const r of rows) console.log(`${String(r.index).padEnd(5)} ${r.laptop.padEnd(17)} ${r.shadow.padEnd(17)} ${r.result}`)
  const urls = slots
    .map((s) => ({ i: s.slot_index, u: s.metadata?.render_shadow?.mp4_url }))
    .filter((x) => x.u)
  console.log("\nShadow MP4s:")
  if (urls.length === 0) console.log("  (none)")
  for (const x of urls) console.log(`  ${x.i}: ${x.u}`)
  if (reason) console.log(`\n${reason}`)
  console.log(`\nVerdict: ${verdict}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
