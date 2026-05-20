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

export function parseSourcingSheet(_rows: string[][]): ParseResult {
  throw new Error("not_implemented")
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

export function parseColorCell(_raw: string): Array<string | null> {
  throw new Error("not_implemented")
}
