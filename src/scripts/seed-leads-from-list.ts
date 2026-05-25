// One-off: import leads (phones + name-only rows) into a named list via the
// in-process Leads module. Runs through the same service.createLead path the
// admin UI uses, so all validation/defaults apply.
//
// Input format: TSV. Each non-blank, non-comment line is either:
//   <phone>                     → phone-only lead
//   <name>                      → name-only lead (no digits in the string)
//   <name>\t<phone>             → both
//
// Lines starting with # are skipped. Existing rows in the DB are NOT deduped;
// run this at most once per list. Within a single run, duplicate phones
// (matched by last-8-digits) are dropped.
//
// Usage:
//   yarn medusa exec ./src/scripts/seed-leads-from-list.ts <list_name> <path-to-input.tsv>

import { readFileSync } from "node:fs"

import { LEADS_MODULE } from "../modules/leads"
import type LeadsModuleService from "../modules/leads/service"

type Row = { name: string | null; phone: string | null }

function parseLines(raw: string): Row[] {
  const out: Row[] = []
  const seenPhoneKey = new Set<string>()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    // TSV split: first tab separates name from phone. If no tab, decide name-
    // vs-phone by whether the line has at least 2 digits.
    const parts = trimmed.split(/\t/)
    let name: string | null = null
    let phone: string | null = null
    if (parts.length >= 2) {
      name = parts[0].trim() || null
      phone = parts.slice(1).join(" ").trim() || null
    } else {
      const digits = trimmed.replace(/\D/g, "")
      if (digits.length >= 2) phone = trimmed
      else name = trimmed
    }

    if (phone) {
      const key = phone.replace(/\D/g, "").slice(-8)
      if (key && seenPhoneKey.has(key)) continue
      if (key) seenPhoneKey.add(key)
    }

    if (!name && !phone) continue
    out.push({ name, phone })
  }
  return out
}

export default async function seedLeadsFromList({
  container,
  args,
}: {
  container: { resolve: <T>(key: string) => T }
  args: string[]
}) {
  const [listName, filePath] = args
  if (!listName || !filePath) {
    throw new Error(
      "Usage: yarn medusa exec ./src/scripts/seed-leads-from-list.ts <list_name> <path-to-input.tsv>",
    )
  }
  const service = container.resolve<LeadsModuleService>(LEADS_MODULE)

  const allLists = await service.getLeadListsWithCounts()
  let target = allLists.find(
    (l) => l.name.toLowerCase() === listName.toLowerCase(),
  )
  if (!target) {
    const created = await service.createLeadList({ name: listName })
    target = { ...created, lead_count: 0 }
    console.log(`Created list "${listName}" (${target.id})`)
  } else {
    console.log(`Using existing list "${target.name}" (${target.id})`)
  }

  const raw = readFileSync(filePath, "utf8")
  const rows = parseLines(raw)
  console.log(`Parsed ${rows.length} rows from ${filePath}`)

  let inserted = 0
  let failed = 0
  for (const row of rows) {
    try {
      await service.createLead({
        name: row.name,
        phone: row.phone,
        list_id: target.id,
      })
      inserted++
    } catch (err) {
      failed++
      console.warn(
        `Skipped (${row.name ?? ""} ${row.phone ?? ""}): ${(err as Error).message}`,
      )
    }
  }
  console.log(`Done. Inserted ${inserted}, failed ${failed}.`)
}
