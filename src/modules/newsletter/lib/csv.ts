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

export function parseContactsCsv(text: string): {
  rows: Array<{ email: string; unsubscribed: boolean }>
  invalid: number
} {
  const records = parseCsvRecords(text.replace(/^﻿/, ""))
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase())
  const emailIdx = header.indexOf("email")
  if (emailIdx === -1) {
    throw new Error("CSV has no email column")
  }
  const unsubIdx = header.indexOf("unsubscribed")

  const seen = new Set<string>()
  const rows: Array<{ email: string; unsubscribed: boolean }> = []
  let invalid = 0
  for (const rec of records.slice(1)) {
    const email = normalizeEmail(rec[emailIdx])
    if (!email) {
      invalid++
      continue
    }
    if (seen.has(email)) continue
    seen.add(email)
    const unsubscribed =
      unsubIdx !== -1 && (rec[unsubIdx] ?? "").trim().toLowerCase() === "true"
    rows.push({ email, unsubscribed })
  }
  return { rows, invalid }
}
