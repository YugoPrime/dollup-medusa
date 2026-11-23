import { normalizeEmail } from "./email"

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++
      row.push(field)
      field = ""
      records.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records.filter((r) => r.some((c) => c.trim() !== ""))
}

const TRUE_WORDS = new Set(["true", "1", "yes"])
const FALSE_WORDS = new Set(["false", "0", "no", ""])
const STATUS_UNSUBSCRIBED = new Set(["unsubscribed", "inactive"])
const STATUS_SUBSCRIBED = new Set(["subscribed", "active", ""])

type FlagColumn = { idx: number; name: string; toUnsubscribed: (v: string) => boolean | null }

/**
 * Picks the column that says who opted out: `unsubscribed`, else `subscribed` (inverted),
 * else `status`. Each maps a trimmed lowercased value to true/false, or null when unknown.
 */
function flagColumn(header: string[]): FlagColumn | null {
  const bool = (v: string) => (TRUE_WORDS.has(v) ? true : FALSE_WORDS.has(v) ? false : null)
  let idx = header.indexOf("unsubscribed")
  if (idx !== -1) return { idx, name: "unsubscribed", toUnsubscribed: bool }
  idx = header.indexOf("subscribed")
  if (idx !== -1) {
    return {
      idx,
      name: "subscribed",
      toUnsubscribed: (v) => {
        const b = bool(v)
        return b === null ? null : !b
      },
    }
  }
  idx = header.indexOf("status")
  if (idx !== -1) {
    return {
      idx,
      name: "status",
      toUnsubscribed: (v) =>
        STATUS_UNSUBSCRIBED.has(v) ? true : STATUS_SUBSCRIBED.has(v) ? false : null,
    }
  }
  return null
}

/**
 * Parses a contacts export. Throws on a missing email column, or on an opt-out value it does
 * not recognise (an opted-out person must never be imported as subscribed by a loose guess).
 * Duplicate emails: the first row wins. `unsubscribedCount` counts rows kept as unsubscribed.
 */
export function parseContactsCsv(text: string): {
  rows: Array<{ email: string; unsubscribed: boolean }>
  invalid: number
  unsubscribedCount: number
} {
  const records = parseCsvRecords(text.replace(/^﻿/, ""))
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase())
  const emailIdx = header.indexOf("email")
  if (emailIdx === -1) {
    throw new Error("CSV has no email column")
  }
  const flag = flagColumn(header)

  const seen = new Set<string>()
  const rows: Array<{ email: string; unsubscribed: boolean }> = []
  let invalid = 0
  let unsubscribedCount = 0
  const data = records.slice(1)
  for (let i = 0; i < data.length; i++) {
    const rec = data[i]
    const email = normalizeEmail(rec[emailIdx])
    if (!email) {
      invalid++
      continue
    }
    let unsubscribed = false
    if (flag) {
      const raw = (rec[flag.idx] ?? "").trim()
      const parsed = flag.toUnsubscribed(raw.toLowerCase())
      if (parsed === null) {
        throw new Error(`Row ${i + 1}: ${flag.name} value "${raw}" not recognised`)
      }
      unsubscribed = parsed
    }
    if (seen.has(email)) continue
    seen.add(email)
    rows.push({ email, unsubscribed })
    if (unsubscribed) unsubscribedCount++
  }
  return { rows, invalid, unsubscribedCount }
}
