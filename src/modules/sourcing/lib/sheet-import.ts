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

export function parseSizeCell(_raw: string): ParsedSizeToken[] {
  throw new Error("not_implemented")
}

export function parseColorCell(_raw: string): Array<string | null> {
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
