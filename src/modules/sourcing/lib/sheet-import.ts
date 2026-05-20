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

export function normalizeSizeLabel(_token: string): string {
  throw new Error("not_implemented")
}
