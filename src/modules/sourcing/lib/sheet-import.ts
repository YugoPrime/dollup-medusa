export type ParsedSizeToken = { size: string; qty: number }
export type ParsedVariant = { color: string | null; size: string; qty: number }

export type ParsedRow = {
  row_index: number
  working_name: string
  cost_usd: number
  qty_total: number
  notes: string | null
  variants: ParsedVariant[]
  warnings: string[]
}

export type UnparseableRow = {
  row_index: number
  raw: string[]
  reason: string
}

export type ParseResult = {
  header_row_index: number
  rows: ParsedRow[]
  unparseable: UnparseableRow[]
}

type ColIdx = { color: number; size: number; qty: number; cost: number }

function findHeader(rows: string[][]): { idx: number; cols: ColIdx | null } {
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map((c) => (c ?? "").toString().trim().toLowerCase())
    const sizeIdx = lower.indexOf("size")
    const qtyIdx = lower.indexOf("qty")
    const costIdx = lower.findIndex((c) =>
      c === "unit price" || c === "price" || c === "cost" || c === "unit cost",
    )
    if (sizeIdx === -1 || qtyIdx === -1 || costIdx === -1) continue
    const colorIdx = lower.indexOf("color")
    return {
      idx: i,
      cols: { color: colorIdx, size: sizeIdx, qty: qtyIdx, cost: costIdx },
    }
  }
  return { idx: -1, cols: null }
}

function readCell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return ""
  const cell = row[idx]
  if (cell === null || cell === undefined) return ""
  return String(cell)
}

function isRowBlank(row: string[]): boolean {
  return row.every((c) => !c || String(c).trim().length === 0)
}

function looksLikeFreeSizePhrase(raw: string): boolean {
  return /free\s*size/i.test(raw) || /one\s*size/i.test(raw)
}

export function parseSourcingSheet(rows: string[][]): ParseResult {
  const { idx, cols } = findHeader(rows)
  if (idx === -1 || !cols) {
    return { header_row_index: -1, rows: [], unparseable: [] }
  }

  const parsedRows: ParsedRow[] = []
  const unparseable: UnparseableRow[] = []
  let itemNumber = 0

  for (let i = idx + 1; i < rows.length; i++) {
    const raw = rows[i]
    if (isRowBlank(raw)) continue

    const sizeCell = readCell(raw, cols.size)
    const qtyCell = readCell(raw, cols.qty).trim()
    const costCell = readCell(raw, cols.cost).trim()
    const colorCell = readCell(raw, cols.color)

    const qty = Number(qtyCell)
    const cost = Number(costCell)

    if (!sizeCell || sizeCell.trim().length === 0) {
      unparseable.push({ row_index: i, raw, reason: "missing size cell" })
      continue
    }
    if (!qtyCell || !Number.isFinite(qty) || qty <= 0) {
      unparseable.push({ row_index: i, raw, reason: "invalid qty" })
      continue
    }

    itemNumber += 1
    const warnings: string[] = []
    const colors = parseColorCell(colorCell)
    let sizeTokens = parseSizeCell(sizeCell)
    let notes: string | null = null

    // Free-form phrase like "free size 3 each" → one OS variant carrying the
    // full row qty (split across colors below).
    if (sizeTokens.length === 0 && looksLikeFreeSizePhrase(sizeCell)) {
      sizeTokens = [{ size: "OS", qty: Math.floor(qty / colors.length) }]
      notes = sizeCell.trim()
    } else if (sizeTokens.length === 0) {
      unparseable.push({ row_index: i, raw, reason: "could not parse size cell" })
      itemNumber -= 1
      continue
    }

    const variants: ParsedVariant[] = []
    for (const color of colors) {
      for (const tok of sizeTokens) {
        variants.push({ color, size: tok.size, qty: tok.qty })
      }
    }

    const sum = variants.reduce((acc, v) => acc + v.qty, 0)
    if (sum !== qty) {
      warnings.push(`qty mismatch: sheet says ${qty}, variants sum to ${sum}`)
    }

    parsedRows.push({
      row_index: i,
      working_name: `Item ${itemNumber}`,
      cost_usd: Number.isFinite(cost) ? cost : 0,
      qty_total: qty,
      notes,
      variants,
      warnings,
    })
  }

  return { header_row_index: idx, rows: parsedRows, unparseable }
}

const SIZE_ALIASES: Record<string, string> = {
  XS: "XS", "X-S": "XS",
  S: "S",
  M: "M",
  L: "L",
  XL: "XL", "X-L": "XL", "1X": "XL", "1XL": "XL",
  XXL: "XXL", "2XL": "XXL", "XX-L": "XXL",
  XXXL: "XXXL", "3XL": "XXXL",
  OS: "OS", "ONE SIZE": "OS", "FREE SIZE": "OS", FREESIZE: "OS",
}

export function normalizeSizeLabel(token: string): string {
  const upper = token.trim().toUpperCase()
  return SIZE_ALIASES[upper] ?? upper
}

// Matches:
//   - qty-prefix + size:  "3S", "12XL", " 2Xl ", "2XL"
//   - size only (qty defaults to 1):  "S", "XL"
// Rejects free-form phrases like "free size 3 each" by requiring the whole
// token (after trim) to match exactly one of these two shapes.
const SIZE_TOKEN_RE = /^(\d+)?\s*([A-Za-z][A-Za-z0-9-]*)$/

export function parseSizeCell(raw: string): ParsedSizeToken[] {
  if (!raw || raw.trim().length === 0) return []
  const out: ParsedSizeToken[] = []
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim()
    if (trimmed.length === 0) continue
    const m = SIZE_TOKEN_RE.exec(trimmed)
    if (!m) {
      // Whole-cell free-form (e.g. "free size 3 each") → caller falls back
      // to row.Qty. Returning [] for the whole cell is what signals that.
      return []
    }

    const prefix = m[1]
    const rest = m[2]
    const wholeUpper = trimmed.toUpperCase()

    // qty is always taken from the digit prefix. The size token is then
    // chosen as either (a) the whole all-caps token when it's a known alias
    // (e.g. "2XL" → "XXL", so "2XL" yields qty=2 + size=XXL), or
    // (b) just the letter portion otherwise (e.g. "2Xl" → qty=2 + size=XL,
    // "3S" → qty=3 + size=S).
    const qty = prefix ? parseInt(prefix, 10) : 1
    let sizeToken: string
    if (prefix && trimmed === wholeUpper && SIZE_ALIASES[wholeUpper]) {
      // All-caps with digit prefix, and it's a known alias
      sizeToken = wholeUpper
    } else {
      // Mixed case, or all-caps but not an alias: treat prefix as qty
      sizeToken = rest
    }

    const size = normalizeSizeLabel(sizeToken)
    out.push({ size, qty })
  }
  return out
}

function titleCaseIfAllCaps(s: string): string {
  if (s !== s.toUpperCase()) return s
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
}

export function parseColorCell(raw: string): Array<string | null> {
  if (!raw || raw.trim().length === 0) return [null]
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(titleCaseIfAllCaps)
  return parts.length === 0 ? [null] : parts
}
