# Sourcing Sheet Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sourcing/import` wizard in `dollup-admin` that turns a Google-Sheet-style supplier sheet (paste TSV / upload .csv / upload .xlsx) into a sourcing `DraftOrder` with parsed `DraftItem`s and `DraftVariant`s, so pre-existing pending orders can be managed inside the new module.

**Architecture:** A pure, browser-safe parser library lives twice — canonical copy in `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts` (covered by Jest unit tests), and a byte-identical mirror in `dollup-admin/src/lib/sheet-import.ts` (admin imports its own copy because the two repos don't share a build). The admin wizard is a 3-step client component: source → preview/edit → confirm. On confirm the browser orchestrates existing endpoints (`POST /admin/sourcing/drafts`, `POST /admin/sourcing/drafts/:id/items`, `PUT /admin/sourcing/items/:id/variants`) in sequence — no new backend route is needed. Partial failures keep already-created items; the page surfaces a per-row status list so the user can retry the failures from the existing draft detail page.

**Tech Stack:** TypeScript, Medusa v2 (sourcing module already exists), Next.js 16 App Router (RSC + client components), React 19, Tailwind v4, Jest 29 for backend tests, `xlsx@^0.20` (SheetJS) dynamically imported in admin only.

---

## Spec reference

Frozen spec: `Backend/dollup-medusa/docs/superpowers/specs/2026-05-21-sourcing-sheet-import-design.md`. Read it before starting.

## File structure

**`Backend/dollup-medusa/` (parser canonical + tests only — NO new API route)**
| Path | Status | Responsibility |
|---|---|---|
| `src/modules/sourcing/lib/sheet-import.ts` | NEW | Pure parser: header detection, size/color tokenization, variant expansion, warnings. Browser-safe (no Node-only deps). |
| `src/modules/sourcing/__tests__/sheet-import.unit.spec.ts` | NEW | Jest unit tests for every parser function + full-sheet fixture. |
| `src/modules/sourcing/__tests__/fixtures/rahvi-2026-04-06.json` | NEW | Frozen `string[][]` of the reference sheet rows, used as the integration fixture. |

**`dollup-admin/` (the actual feature surface)**
| Path | Status | Responsibility |
|---|---|---|
| `src/lib/sheet-import.ts` | NEW | Byte-identical mirror of backend parser (admin can't reach the backend repo's source). |
| `src/lib/sheet-import.xlsx.ts` | NEW | Tiny xlsx-to-rows helper. Dynamically imports `xlsx`. Browser-only. |
| `src/app/(app)/sourcing/import/page.tsx` | NEW | Server entry — fetches active suppliers, renders the client wizard. |
| `src/app/(app)/sourcing/import/ImportWizard.tsx` | NEW | Client component: holds state across 3 steps. |
| `src/app/(app)/sourcing/import/steps/SourceStep.tsx` | NEW | Step 1: supplier + currency + TSV textarea or file upload + Parse button. |
| `src/app/(app)/sourcing/import/steps/PreviewStep.tsx` | NEW | Step 2: editable table of parsed rows + warnings + Back/Continue. |
| `src/app/(app)/sourcing/import/steps/ConfirmStep.tsx` | NEW | Step 3: summary + Create draft button + per-row progress list. |
| `src/app/(app)/sourcing/page.tsx` | MODIFY | Add "Import from sheet" link at top of page. |
| `package.json` | MODIFY | Add `"xlsx": "^0.20"` dependency. |

**No backend API additions.** All persistence uses the already-shipped endpoints:
- `POST /admin/sourcing/drafts` — `sourcing.createDraft(supplierId)` in `admin-sourcing.ts:165`
- `POST /admin/sourcing/drafts/:id/items` — `sourcing.createItem(draftId, input)` in `admin-sourcing.ts:196`
- `PUT /admin/sourcing/items/:id/variants` — `sourcing.replaceVariants(itemId, variants)` in `admin-sourcing.ts:240`
- `POST /admin/sourcing/suppliers` — `sourcing.createSupplier(input)` in `admin-sourcing.ts:128`
- `GET /admin/sourcing/suppliers` — `sourcing.listSuppliers("active")` in `admin-sourcing.ts:115`

---

## Phase 1 — Backend parser (TDD, tested in isolation)

### Task 1.1 — Constants + types skeleton

**Files:**
- Create: `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts`

- [ ] **Step 1: Create the skeleton file with exported types and a stub `parseSourcingSheet`**

```ts
// Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts

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
```

- [ ] **Step 2: Commit the skeleton so subsequent failing tests have something to import**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
git add src/modules/sourcing/lib/sheet-import.ts
git commit -m "feat(sourcing): scaffold sheet-import parser types"
```

---

### Task 1.2 — `normalizeSizeLabel` (TDD)

**Files:**
- Create: `Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`
- Modify: `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
import { normalizeSizeLabel } from "../lib/sheet-import"

describe("normalizeSizeLabel", () => {
  const cases: Array<[string, string]> = [
    ["S", "S"],
    ["s", "S"],
    ["m", "M"],
    ["L", "L"],
    ["XS", "XS"],
    ["xs", "XS"],
    ["XL", "XL"],
    ["xl", "XL"],
    ["Xl", "XL"],
    ["1x", "XL"],
    ["1XL", "XL"],
    ["XXL", "XXL"],
    ["xxl", "XXL"],
    ["2xl", "XXL"],
    ["2XL", "XXL"],
    ["XXXL", "XXXL"],
    ["3xl", "XXXL"],
    ["OS", "OS"],
    ["os", "OS"],
    ["one size", "OS"],
    ["free size", "OS"],
    ["freesize", "OS"],
  ]
  it.each(cases)("normalizes %s → %s", (input, expected) => {
    expect(normalizeSizeLabel(input)).toBe(expected)
  })

  it("uppercases and returns unknown tokens unchanged", () => {
    expect(normalizeSizeLabel("foo")).toBe("FOO")
  })

  it("trims whitespace", () => {
    expect(normalizeSizeLabel("  m  ")).toBe("M")
  })
})
```

- [ ] **Step 2: Run the test, confirm failure**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
yarn test:unit --testPathPattern=sheet-import
```

Expected: all 22 cases fail with `not_implemented`.

- [ ] **Step 3: Implement `normalizeSizeLabel`**

Replace the stub in `src/modules/sourcing/lib/sheet-import.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 22 passing.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/sourcing/lib/sheet-import.ts src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
git commit -m "feat(sourcing): normalizeSizeLabel covers XS-XXXL, free size variants"
```

---

### Task 1.3 — `parseSizeCell` (TDD)

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`
- Modify: `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts`

- [ ] **Step 1: Add failing tests for `parseSizeCell`**

Append to `sheet-import.unit.spec.ts`:

```ts
import { parseSizeCell } from "../lib/sheet-import"

describe("parseSizeCell", () => {
  it("parses qty-prefixed tokens (real sheet row 1)", () => {
    expect(parseSizeCell("3S,4M,3L")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 4 },
      { size: "L", qty: 3 },
    ])
  })

  it("parses Xl as XL (real sheet row 2)", () => {
    expect(parseSizeCell("3S,3M,3L,3Xl")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 3 },
      { size: "L", qty: 3 },
      { size: "XL", qty: 3 },
    ])
  })

  it("disambiguates Xl (=XL) vs 2XL (=XXL) in the same cell (real sheet row 14)", () => {
    expect(parseSizeCell("3S,3M,2L,2Xl, 2XL")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 3 },
      { size: "L", qty: 2 },
      { size: "XL", qty: 2 },
      { size: "XXL", qty: 2 },
    ])
  })

  it("parses XS through XXL (real sheet row 15)", () => {
    expect(parseSizeCell("2XS,2S,2M,2L,2XL")).toEqual([
      { size: "XS", qty: 2 },
      { size: "S", qty: 2 },
      { size: "M", qty: 2 },
      { size: "L", qty: 2 },
      { size: "XXL", qty: 2 },
    ])
  })

  it("returns empty array when no qty prefix and free-size phrase (real sheet row 10)", () => {
    // "free size 3 each" is a free-form phrase, not a size token list.
    // It must NOT auto-parse; row-level logic handles it via the Qty column.
    expect(parseSizeCell("free size 3 each")).toEqual([])
  })

  it("defaults missing qty prefix to 1", () => {
    expect(parseSizeCell("S,M,L")).toEqual([
      { size: "S", qty: 1 },
      { size: "M", qty: 1 },
      { size: "L", qty: 1 },
    ])
  })

  it("trims whitespace and tolerates trailing comma", () => {
    expect(parseSizeCell("  3S , 4M , 3L , ")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 4 },
      { size: "L", qty: 3 },
    ])
  })

  it("returns empty array for empty input", () => {
    expect(parseSizeCell("")).toEqual([])
    expect(parseSizeCell("   ")).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 8 new failures.

- [ ] **Step 3: Implement `parseSizeCell`**

Replace the stub:

```ts
// Matches:
//   - qty-prefix + size:  "3S", "12XL", " 2Xl "
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
    const qty = m[1] ? parseInt(m[1], 10) : 1
    const size = normalizeSizeLabel(m[2])
    out.push({ size, qty })
  }
  return out
}
```

- [ ] **Step 4: Run tests, confirm pass**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 30 passing total.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/sourcing/lib/sheet-import.ts src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
git commit -m "feat(sourcing): parseSizeCell handles qty-prefix, Xl/XXL split, free-size fallback"
```

---

### Task 1.4 — `parseColorCell` (TDD)

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`
- Modify: `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
import { parseColorCell } from "../lib/sheet-import"

describe("parseColorCell", () => {
  it("returns [null] for blank cell", () => {
    expect(parseColorCell("")).toEqual([null])
    expect(parseColorCell("   ")).toEqual([null])
  })

  it("returns single trimmed color", () => {
    expect(parseColorCell("Brown")).toEqual(["Brown"])
    expect(parseColorCell("  BLACK  ")).toEqual(["Black"])
  })

  it("splits comma-separated multi-color (real sheet row 9 — preserves Brugandy typo)", () => {
    expect(parseColorCell("Brugandy, White,")).toEqual(["Brugandy", "White"])
  })

  it("splits 3-color cell (real sheet row 15)", () => {
    expect(parseColorCell("Black, White, Light Yellow")).toEqual([
      "Black",
      "White",
      "Light Yellow",
    ])
  })

  it("title-cases ALL CAPS but keeps mixed-case as-is", () => {
    expect(parseColorCell("BLACK")).toEqual(["Black"])
    expect(parseColorCell("Light Yellow")).toEqual(["Light Yellow"])
  })
})
```

- [ ] **Step 2: Confirm fail**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

- [ ] **Step 3: Implement**

Replace the stub:

```ts
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
```

- [ ] **Step 4: Confirm pass**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 35 passing.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/sourcing/lib/sheet-import.ts src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
git commit -m "feat(sourcing): parseColorCell handles blank, multi-color, ALL CAPS"
```

---

### Task 1.5 — Reference-sheet fixture

**Files:**
- Create: `Backend/dollup-medusa/src/modules/sourcing/__tests__/fixtures/rahvi-2026-04-06.json`

- [ ] **Step 1: Write the fixture (verbatim from xlsx readout in the design phase)**

```json
[
  ["Color", "Size", "Qty", "unit price ", "total ", ""],
  ["Brown", "3S,4M,3L", "10", "6.15384615384615", "61.5384615384615", ""],
  ["", "3S,3M,3L,3Xl", "12", "4.15384615384615", "49.8461538461538", ""],
  ["", "3S,4M,3L", "10", "7.38461538461539", "73.8461538461539", ""],
  ["", "3S,3M,2L,2Xl", "10", "6.30769230769231", "63.0769230769231", ""],
  ["", "3S,3M,2L,2Xl,2XL", "12", "6.49230769230769", "77.90769230769227", ""],
  ["", "3S,3M,2L,2Xl", "10", "6.90769230769231", "69.0769230769231", ""],
  ["", "3S,3M,2L,2Xl", "10", "9.73846153846154", "97.38461538461539", ""],
  ["", "3S,3M,2L,2Xl", "10", "6.61538461538461", "66.1538461538461", ""],
  ["Brugandy, White,", "3S,3M,2L,2Xl", "20", "5.46923076923077", "109.3846153846154", ""],
  ["", "free size 3 each", "12", "2.69230769230769", "32.30769230769228", ""],
  ["", "3S,3M,2L,2Xl", "10", "3.61538461538462", "36.153846153846196", ""],
  ["", "3S,4M,3L", "10", "5.38461538461539", "53.8461538461539", ""],
  ["", "3S,4M,3L", "10", "6.76923076923077", "67.69230769230771", ""],
  ["", "3S,3M,2L,2Xl, 2XL", "14", "7.07692307692308", "99.07692307692312", ""],
  ["Black, White, Light Yellow", "2XS,2S,2M,2L,2XL", "30", "5.46923076923077", "164.0769230769231", ""],
  ["BLACK ", "3S,4M,3L", "10", "6.43076923076923", "64.3076923076923", ""]
]
```

- [ ] **Step 2: Commit**

```powershell
git add src/modules/sourcing/__tests__/fixtures/rahvi-2026-04-06.json
git commit -m "test(sourcing): freeze rahvi 2026-04-06 supplier sheet as fixture"
```

---

### Task 1.6 — `parseSourcingSheet` (TDD against the fixture)

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`
- Modify: `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts`

- [ ] **Step 1: Add failing tests for header detection**

Append:

```ts
import { parseSourcingSheet } from "../lib/sheet-import"
import fixture from "./fixtures/rahvi-2026-04-06.json"

describe("parseSourcingSheet — header detection", () => {
  it("finds header on row 0 of the reference sheet", () => {
    const r = parseSourcingSheet(fixture as string[][])
    expect(r.header_row_index).toBe(0)
  })

  it("finds header even with leading blank rows", () => {
    const rows = [["", "", "", "", ""], ["", "", "", "", ""], ...(fixture as string[][])]
    const r = parseSourcingSheet(rows)
    expect(r.header_row_index).toBe(2)
  })

  it("returns empty result when no header is found", () => {
    const r = parseSourcingSheet([["foo", "bar"], ["1", "2"]])
    expect(r.header_row_index).toBe(-1)
    expect(r.rows).toEqual([])
    expect(r.unparseable).toEqual([])
  })
})
```

- [ ] **Step 2: Confirm fail**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

- [ ] **Step 3: Implement header detection + skeleton row loop**

Replace the `parseSourcingSheet` stub with a first cut that only finds the header and returns no rows yet — keeps the TDD steps small:

```ts
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

export function parseSourcingSheet(rows: string[][]): ParseResult {
  const { idx, cols } = findHeader(rows)
  if (idx === -1 || !cols) {
    return { header_row_index: -1, rows: [], unparseable: [] }
  }
  // Row parsing added in next TDD step.
  return { header_row_index: idx, rows: [], unparseable: [] }
}
```

- [ ] **Step 4: Confirm header tests pass**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 38 passing.

- [ ] **Step 5: Add failing tests for row parsing (the meat)**

Append:

```ts
describe("parseSourcingSheet — fixture row expansion", () => {
  const result = parseSourcingSheet(fixture as string[][])

  it("produces 16 parsed rows + 0 unparseable", () => {
    expect(result.rows.length).toBe(16)
    expect(result.unparseable.length).toBe(0)
  })

  it("auto-names items Item 1..Item 16", () => {
    expect(result.rows.map((r) => r.working_name)).toEqual(
      Array.from({ length: 16 }, (_, i) => `Item ${i + 1}`),
    )
  })

  it("row 1 (Brown, 3S/4M/3L) — 1 color × 3 sizes = 3 variants summing to 10", () => {
    const r = result.rows[0]
    expect(r.variants).toEqual([
      { color: "Brown", size: "S", qty: 3 },
      { color: "Brown", size: "M", qty: 4 },
      { color: "Brown", size: "L", qty: 3 },
    ])
    expect(r.qty_total).toBe(10)
    expect(r.cost_usd).toBeCloseTo(6.15384615384615)
    expect(r.warnings).toEqual([])
  })

  it("row 9 (Brugandy+White, 3S/3M/2L/2Xl, qty=20) — 2 colors × 4 sizes = 8 variants summing to 20", () => {
    const r = result.rows[8]
    expect(r.variants).toHaveLength(8)
    const total = r.variants.reduce((acc, v) => acc + v.qty, 0)
    expect(total).toBe(20)
    expect(new Set(r.variants.map((v) => v.color))).toEqual(
      new Set(["Brugandy", "White"]),
    )
    expect(r.warnings).toEqual([])
  })

  it("row 10 (free size 3 each, qty=12) — 1 variant size=OS qty=12, raw cell preserved in notes", () => {
    const r = result.rows[9]
    expect(r.variants).toEqual([{ color: null, size: "OS", qty: 12 }])
    expect(r.notes).toBe("free size 3 each")
  })

  it("row 14 (mixed Xl + 2XL, qty=14) — 5 sizes (S/M/L/XL/XXL) summing to 12, with qty-mismatch warning", () => {
    const r = result.rows[13]
    expect(r.variants).toEqual([
      { color: null, size: "S", qty: 3 },
      { color: null, size: "M", qty: 3 },
      { color: null, size: "L", qty: 2 },
      { color: null, size: "XL", qty: 2 },
      { color: null, size: "XXL", qty: 2 },
    ])
    expect(r.qty_total).toBe(14)
    expect(r.warnings).toEqual([
      "qty mismatch: sheet says 14, variants sum to 12",
    ])
  })

  it("row 15 (3 colors × 5 sizes, qty=30) — 15 variants summing to 30", () => {
    const r = result.rows[14]
    expect(r.variants).toHaveLength(15)
    expect(r.variants.reduce((a, v) => a + v.qty, 0)).toBe(30)
    expect(new Set(r.variants.map((v) => v.color))).toEqual(
      new Set(["Black", "White", "Light Yellow"]),
    )
  })

  it("row 16 (BLACK, 3S/4M/3L) — color normalized to Black", () => {
    expect(result.rows[15].variants.map((v) => v.color)).toEqual([
      "Black",
      "Black",
      "Black",
    ])
  })
})
```

- [ ] **Step 6: Confirm fail**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

- [ ] **Step 7: Implement row loop, free-size fallback, qty-mismatch warning**

Replace the `parseSourcingSheet` body (keep `findHeader` as-is):

```ts
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
```

- [ ] **Step 8: Confirm all tests pass**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 45 passing total.

- [ ] **Step 9: Commit**

```powershell
git add src/modules/sourcing/lib/sheet-import.ts src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
git commit -m "feat(sourcing): parseSourcingSheet expands variants, flags qty mismatches"
```

---

### Task 1.7 — Edge-case tests + final polish

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`

- [ ] **Step 1: Add edge-case tests (no implementation change needed if parser is right)**

Append:

```ts
describe("parseSourcingSheet — edge cases", () => {
  it("skips blank rows between items", () => {
    const rows = [
      ["Color", "Size", "Qty", "unit price"],
      ["Brown", "3S,3M", "6", "5.00"],
      ["", "", "", ""],
      ["", "3S,3M", "6", "4.00"],
    ]
    const r = parseSourcingSheet(rows)
    expect(r.rows.length).toBe(2)
  })

  it("records missing-size rows as unparseable", () => {
    const rows = [
      ["Color", "Size", "Qty", "unit price"],
      ["Brown", "", "10", "5.00"],
    ]
    const r = parseSourcingSheet(rows)
    expect(r.rows.length).toBe(0)
    expect(r.unparseable).toEqual([
      { row_index: 1, raw: ["Brown", "", "10", "5.00"], reason: "missing size cell" },
    ])
  })

  it("records invalid-qty rows as unparseable", () => {
    const rows = [
      ["Color", "Size", "Qty", "unit price"],
      ["Brown", "3S,3M", "abc", "5.00"],
      ["Brown", "3S,3M", "0", "5.00"],
    ]
    const r = parseSourcingSheet(rows)
    expect(r.rows.length).toBe(0)
    expect(r.unparseable.map((u) => u.reason)).toEqual([
      "invalid qty",
      "invalid qty",
    ])
  })

  it("accepts 'price' or 'cost' as the cost column header", () => {
    const r1 = parseSourcingSheet([
      ["Color", "Size", "Qty", "price"],
      ["Brown", "3S", "3", "5.00"],
    ])
    expect(r1.rows.length).toBe(1)
    const r2 = parseSourcingSheet([
      ["Color", "Size", "Qty", "cost"],
      ["Brown", "3S", "3", "5.00"],
    ])
    expect(r2.rows.length).toBe(1)
  })

  it("tolerates missing color column entirely", () => {
    const rows = [
      ["Size", "Qty", "unit price"],
      ["3S,3M", "6", "5.00"],
    ]
    const r = parseSourcingSheet(rows)
    expect(r.rows[0].variants.map((v) => v.color)).toEqual([null, null])
  })
})
```

- [ ] **Step 2: Run tests**

```powershell
yarn test:unit --testPathPattern=sheet-import
```

Expected: 50 passing. If any fail, fix the parser inline (most likely culprit: `cols.color === -1` path in `findHeader`; if it fails, change `findHeader` to allow `colorIdx === -1` — current code already does).

- [ ] **Step 3: Commit**

```powershell
git add src/modules/sourcing/__tests__/sheet-import.unit.spec.ts
git commit -m "test(sourcing): edge cases — blank rows, missing color column, invalid qty"
```

---

## Phase 2 — Admin mirror parser

### Task 2.1 — Mirror the parser into dollup-admin

**Files:**
- Create: `dollup-admin/src/lib/sheet-import.ts`

- [ ] **Step 1: Copy the canonical parser verbatim into the admin repo**

Copy `Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts` to `dollup-admin/src/lib/sheet-import.ts` byte-for-byte. Add this header at the top:

```ts
// MIRROR — keep in sync with Backend/dollup-medusa/src/modules/sourcing/lib/sheet-import.ts
// Canonical tests live in the backend repo. Do not diverge.
```

- [ ] **Step 2: Verify admin still typechecks**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
git add src/lib/sheet-import.ts
git commit -m "feat(admin): mirror sheet-import parser from backend"
```

---

### Task 2.2 — xlsx helper (dynamic import, browser-only)

**Files:**
- Modify: `dollup-admin/package.json`
- Create: `dollup-admin/src/lib/sheet-import.xlsx.ts`

- [ ] **Step 1: Add `xlsx` as a runtime dep**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npm install xlsx@^0.20.3
```

- [ ] **Step 2: Verify install summary**

```powershell
npm ls xlsx
```

Expected output line: `xlsx@0.20.3` (or newer 0.20.x).

- [ ] **Step 3: Write the helper**

```ts
// dollup-admin/src/lib/sheet-import.xlsx.ts
"use client"

// Reads the first worksheet from an xlsx file and returns rows as string[][].
// Dynamically imports xlsx so the ~600KB chunk only loads on the import page.
export async function xlsxFileToRows(file: File): Promise<string[][]> {
  const xlsx = await import("xlsx")
  const buf = await file.arrayBuffer()
  const wb = xlsx.read(buf, { type: "array" })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) return []
  const ws = wb.Sheets[firstSheetName]
  const rows = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })
  return rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))))
}

// Parses a TSV/CSV string into rows. Auto-detects tab vs comma based on the
// first non-empty line. No quoting support — Google Sheets paste produces
// tab-separated text without quotes for sheets without embedded tabs/newlines,
// which covers our use case.
export function pastedTextToRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const sep = lines[0].includes("\t") ? "\t" : ","
  return lines.map((line) => line.split(sep))
}
```

- [ ] **Step 4: Confirm typecheck**

```powershell
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json src/lib/sheet-import.xlsx.ts
git commit -m "feat(admin): xlsx + TSV/CSV readers for sheet-import wizard"
```

---

## Phase 3 — Admin wizard UI

### Task 3.1 — Server entry page

**Files:**
- Create: `dollup-admin/src/app/(app)/sourcing/import/page.tsx`

- [ ] **Step 1: Write the server entry**

```tsx
// dollup-admin/src/app/(app)/sourcing/import/page.tsx
import type { Metadata } from "next"
import { sourcing } from "@/lib/admin-sourcing"
import { ImportWizard } from "./ImportWizard"

export const metadata: Metadata = {
  title: "Sourcing — Import sheet",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function SourcingImportPage() {
  const { suppliers } = await sourcing.listSuppliers("active", {
    includeCounts: false,
  })
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-xl font-semibold">Import sheet → draft order</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Paste TSV from Google Sheets or upload a .csv / .xlsx. Variants are
        parsed from qty-prefixed size tokens like <code>3S,4M,3L</code>.
      </p>
      <ImportWizard initialSuppliers={suppliers} />
    </div>
  )
}
```

- [ ] **Step 2: Add the wizard stub so the page compiles**

Create `dollup-admin/src/app/(app)/sourcing/import/ImportWizard.tsx`:

```tsx
"use client"

import type { Supplier } from "@/lib/admin-sourcing"

export function ImportWizard({
  initialSuppliers,
}: {
  initialSuppliers: Supplier[]
}) {
  return (
    <div className="rounded border border-dashed p-8 text-sm text-neutral-500">
      Wizard scaffold — {initialSuppliers.length} suppliers loaded.
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + dev-server smoke**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npx tsc --noEmit
```

Expected: zero errors. (Don't run dev server yet — full smoke after Task 3.5.)

- [ ] **Step 4: Commit**

```powershell
git add src/app/"(app)"/sourcing/import/page.tsx src/app/"(app)"/sourcing/import/ImportWizard.tsx
git commit -m "feat(admin): /sourcing/import page scaffold"
```

---

### Task 3.2 — Step 1: SourceStep (supplier picker + paste/upload)

**Files:**
- Create: `dollup-admin/src/app/(app)/sourcing/import/steps/SourceStep.tsx`
- Modify: `dollup-admin/src/app/(app)/sourcing/import/ImportWizard.tsx`

- [ ] **Step 1: Write `SourceStep`**

```tsx
// dollup-admin/src/app/(app)/sourcing/import/steps/SourceStep.tsx
"use client"

import { useState } from "react"
import type { Supplier } from "@/lib/admin-sourcing"
import { sourcing } from "@/lib/admin-sourcing"
import { pastedTextToRows, xlsxFileToRows } from "@/lib/sheet-import.xlsx"

export type SourceStepValue = {
  supplier: Supplier
  currency: string
  rows: string[][]
}

export function SourceStep({
  suppliers,
  onSuppliersChange,
  onParse,
}: {
  suppliers: Supplier[]
  onSuppliersChange: (next: Supplier[]) => void
  onParse: (value: SourceStepValue) => void
}) {
  const [supplierId, setSupplierId] = useState<string>(suppliers[0]?.id ?? "")
  const [currency, setCurrency] = useState("USD")
  const [mode, setMode] = useState<"paste" | "upload">("paste")
  const [pasted, setPasted] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")

  async function handleParse() {
    setError(null)
    const supplier = suppliers.find((s) => s.id === supplierId)
    if (!supplier) {
      setError("Pick a supplier first.")
      return
    }
    setBusy(true)
    try {
      let rows: string[][] = []
      if (mode === "paste") {
        rows = pastedTextToRows(pasted)
      } else if (file) {
        rows = await xlsxFileToRows(file)
      }
      if (rows.length === 0) {
        setError("No rows found in the input.")
        return
      }
      onParse({ supplier, currency, rows })
    } catch (e) {
      setError((e as Error).message ?? "Failed to read input")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateSupplier() {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const res = await sourcing.createSupplier({ name: newName.trim() })
      const created = res.supplier as Supplier
      onSuppliersChange([created, ...suppliers])
      setSupplierId(created.id)
      setShowNew(false)
      setNewName("")
    } catch (e) {
      setError((e as Error).message ?? "Failed to create supplier")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded border p-4">
      <div className="flex items-end gap-3">
        <label className="flex-1">
          <span className="block text-sm font-medium">Supplier</span>
          <select
            className="mt-1 w-full rounded border px-2 py-1"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="w-32">
          <span className="block text-sm font-medium">Currency</span>
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={() => setShowNew((v) => !v)}
        >
          {showNew ? "Cancel" : "New supplier"}
        </button>
      </div>

      {showNew && (
        <div className="flex items-end gap-2 rounded bg-neutral-50 p-3">
          <label className="flex-1">
            <span className="block text-sm font-medium">New supplier name</span>
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </label>
          <button
            type="button"
            className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
            disabled={busy || !newName.trim()}
            onClick={handleCreateSupplier}
          >
            Create
          </button>
        </div>
      )}

      <div className="flex gap-2 border-b">
        {(["paste", "upload"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`px-3 py-2 text-sm ${
              mode === m
                ? "border-b-2 border-black font-medium"
                : "text-neutral-500"
            }`}
            onClick={() => setMode(m)}
          >
            {m === "paste" ? "Paste TSV/CSV" : "Upload .csv / .xlsx"}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <textarea
          className="h-64 w-full rounded border p-2 font-mono text-sm"
          placeholder="Paste from Google Sheets here (header row first)"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
      ) : (
        <input
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      )}

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={
            busy ||
            !supplierId ||
            (mode === "paste" ? !pasted.trim() : !file)
          }
          onClick={handleParse}
        >
          {busy ? "Reading…" : "Parse →"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire SourceStep into ImportWizard (keeps preview/confirm steps as stubs for now)**

Replace `dollup-admin/src/app/(app)/sourcing/import/ImportWizard.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { Supplier } from "@/lib/admin-sourcing"
import { parseSourcingSheet, type ParseResult } from "@/lib/sheet-import"
import { SourceStep, type SourceStepValue } from "./steps/SourceStep"

type Stage = "source" | "preview" | "confirm"

export function ImportWizard({
  initialSuppliers,
}: {
  initialSuppliers: Supplier[]
}) {
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [stage, setStage] = useState<Stage>("source")
  const [source, setSource] = useState<SourceStepValue | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)

  return (
    <div className="space-y-6">
      <Breadcrumbs stage={stage} />
      {stage === "source" && (
        <SourceStep
          suppliers={suppliers}
          onSuppliersChange={setSuppliers}
          onParse={(value) => {
            setSource(value)
            setParsed(parseSourcingSheet(value.rows))
            setStage("preview")
          }}
        />
      )}
      {stage === "preview" && source && parsed && (
        <div className="rounded border border-dashed p-8 text-sm text-neutral-500">
          Preview step — {parsed.rows.length} rows / {parsed.unparseable.length} unparseable.
        </div>
      )}
      {stage === "confirm" && (
        <div className="rounded border border-dashed p-8 text-sm text-neutral-500">
          Confirm step — TODO.
        </div>
      )}
    </div>
  )
}

function Breadcrumbs({ stage }: { stage: Stage }) {
  const items: Array<[Stage, string]> = [
    ["source", "1. Source"],
    ["preview", "2. Preview"],
    ["confirm", "3. Confirm"],
  ]
  return (
    <ol className="flex gap-2 text-sm">
      {items.map(([s, label]) => (
        <li
          key={s}
          className={`rounded px-3 py-1 ${
            s === stage ? "bg-black text-white" : "bg-neutral-100 text-neutral-500"
          }`}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 3: Typecheck**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add src/app/"(app)"/sourcing/import/steps/SourceStep.tsx src/app/"(app)"/sourcing/import/ImportWizard.tsx
git commit -m "feat(admin): SourceStep — supplier picker + TSV paste / xlsx upload"
```

---

### Task 3.3 — Step 2: PreviewStep (editable table + warnings)

**Files:**
- Create: `dollup-admin/src/app/(app)/sourcing/import/steps/PreviewStep.tsx`
- Modify: `dollup-admin/src/app/(app)/sourcing/import/ImportWizard.tsx`

- [ ] **Step 1: Write `PreviewStep`**

```tsx
// dollup-admin/src/app/(app)/sourcing/import/steps/PreviewStep.tsx
"use client"

import { useState } from "react"
import type { ParseResult, ParsedRow, ParsedVariant } from "@/lib/sheet-import"

export type EditableRow = {
  working_name: string
  cost_usd: number
  notes: string | null
  variants: ParsedVariant[]
  warnings: string[]
  source_row_index: number
}

function toEditable(rows: ParsedRow[]): EditableRow[] {
  return rows.map((r) => ({
    working_name: r.working_name,
    cost_usd: r.cost_usd,
    notes: r.notes,
    variants: r.variants,
    warnings: r.warnings,
    source_row_index: r.row_index,
  }))
}

function variantsLabel(variants: ParsedVariant[]): string {
  const grouped = new Map<string, number[]>()
  for (const v of variants) {
    const key = v.color ?? "—"
    const arr = grouped.get(key) ?? []
    arr.push(v.qty)
    grouped.set(key, arr)
  }
  return Array.from(grouped.entries())
    .map(
      ([color, qtys]) =>
        `${color}: ${variants
          .filter((v) => (v.color ?? "—") === color)
          .map((v) => `${v.qty}${v.size}`)
          .join(",")}`,
    )
    .join(" | ")
}

export function PreviewStep({
  parsed,
  onBack,
  onContinue,
}: {
  parsed: ParseResult
  onBack: () => void
  onContinue: (rows: EditableRow[]) => void
}) {
  const [rows, setRows] = useState<EditableRow[]>(toEditable(parsed.rows))

  function patchRow(i: number, patch: Partial<EditableRow>) {
    setRows((curr) => curr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function removeRow(i: number) {
    setRows((curr) => curr.filter((_, idx) => idx !== i))
  }

  const totalVariants = rows.reduce((acc, r) => acc + r.variants.length, 0)
  const totalPcs = rows.reduce(
    (acc, r) => acc + r.variants.reduce((a, v) => a + v.qty, 0),
    0,
  )
  const totalSpend = rows.reduce(
    (acc, r) =>
      acc + r.cost_usd * r.variants.reduce((a, v) => a + v.qty, 0),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex gap-3 text-sm">
        <Chip label={`${rows.length} items`} />
        <Chip label={`${totalVariants} variants`} />
        <Chip label={`${totalPcs} pcs`} />
        <Chip label={`$${totalSpend.toFixed(2)}`} />
        {parsed.unparseable.length > 0 && (
          <Chip
            tone="warn"
            label={`${parsed.unparseable.length} unparseable`}
          />
        )}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-2 py-1">Name</th>
            <th className="px-2 py-1">Cost USD</th>
            <th className="px-2 py-1">Variants</th>
            <th className="px-2 py-1">Notes</th>
            <th className="px-2 py-1">Warnings</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.source_row_index} className="border-b align-top">
              <td className="px-2 py-1">
                <input
                  className="w-40 rounded border px-1 py-0.5"
                  value={r.working_name}
                  onChange={(e) => patchRow(i, { working_name: e.target.value })}
                />
              </td>
              <td className="px-2 py-1">
                <input
                  type="number"
                  step="0.01"
                  className="w-20 rounded border px-1 py-0.5"
                  value={r.cost_usd}
                  onChange={(e) =>
                    patchRow(i, { cost_usd: Number(e.target.value) })
                  }
                />
              </td>
              <td className="px-2 py-1 font-mono text-xs">
                {variantsLabel(r.variants)}
              </td>
              <td className="px-2 py-1">
                <input
                  className="w-40 rounded border px-1 py-0.5"
                  value={r.notes ?? ""}
                  onChange={(e) =>
                    patchRow(i, { notes: e.target.value || null })
                  }
                />
              </td>
              <td className="px-2 py-1 text-xs text-amber-700">
                {r.warnings.join("; ")}
              </td>
              <td className="px-2 py-1 text-right">
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => removeRow(i)}
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {parsed.unparseable.length > 0 && (
        <details className="rounded border bg-neutral-50 p-2 text-sm">
          <summary>Unparseable rows ({parsed.unparseable.length})</summary>
          <ul className="mt-2 list-disc pl-6 text-xs">
            {parsed.unparseable.map((u) => (
              <li key={u.row_index}>
                row {u.row_index}: {u.reason} — <code>{JSON.stringify(u.raw)}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={onBack}
        >
          ← Back
        </button>
        <button
          type="button"
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={rows.length === 0}
          onClick={() => onContinue(rows)}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

function Chip({
  label,
  tone = "default",
}: {
  label: string
  tone?: "default" | "warn"
}) {
  return (
    <span
      className={`rounded px-2 py-0.5 ${
        tone === "warn"
          ? "bg-amber-100 text-amber-900"
          : "bg-neutral-100 text-neutral-700"
      }`}
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 2: Wire PreviewStep into ImportWizard**

Modify `ImportWizard.tsx`:

```tsx
// (top)
import { PreviewStep, type EditableRow } from "./steps/PreviewStep"

// inside the component, replace the existing `preview` placeholder block:
const [editableRows, setEditableRows] = useState<EditableRow[] | null>(null)

// in JSX:
{stage === "preview" && source && parsed && (
  <PreviewStep
    parsed={parsed}
    onBack={() => setStage("source")}
    onContinue={(rows) => {
      setEditableRows(rows)
      setStage("confirm")
    }}
  />
)}
```

- [ ] **Step 3: Typecheck**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add src/app/"(app)"/sourcing/import/steps/PreviewStep.tsx src/app/"(app)"/sourcing/import/ImportWizard.tsx
git commit -m "feat(admin): PreviewStep — editable rows, warnings, summary chips"
```

---

### Task 3.4 — Step 3: ConfirmStep (creates draft + items + variants)

**Files:**
- Create: `dollup-admin/src/app/(app)/sourcing/import/steps/ConfirmStep.tsx`
- Modify: `dollup-admin/src/app/(app)/sourcing/import/ImportWizard.tsx`

- [ ] **Step 1: Write `ConfirmStep`**

```tsx
// dollup-admin/src/app/(app)/sourcing/import/steps/ConfirmStep.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { Supplier } from "@/lib/admin-sourcing"
import { sourcing } from "@/lib/admin-sourcing"
import type { EditableRow } from "./PreviewStep"

type ItemStatus =
  | { state: "pending"; name: string }
  | { state: "creating"; name: string }
  | { state: "ok"; name: string; itemId: string }
  | { state: "failed"; name: string; error: string }

export function ConfirmStep({
  supplier,
  currency,
  rows,
  onBack,
}: {
  supplier: Supplier
  currency: string
  rows: EditableRow[]
  onBack: () => void
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<ItemStatus[]>(
    rows.map((r) => ({ state: "pending", name: r.working_name })),
  )
  const [topError, setTopError] = useState<string | null>(null)

  function updateStatus(i: number, next: ItemStatus) {
    setStatuses((curr) => curr.map((s, idx) => (idx === i ? next : s)))
  }

  async function handleCreate() {
    setCreating(true)
    setTopError(null)
    try {
      // 1. Create the draft.
      const { draft } = await sourcing.createDraft(supplier.id)
      setDraftId(draft.id)
      // (currency: the backend defaults to USD; if the user picked a non-USD
      // currency we patch the draft afterwards. Most imports are USD.)
      if (currency !== "USD") {
        // No public method exists for currency yet; we leave a note instead
        // so the user can change it manually in the existing draft page.
        await sourcing.updateDraft(draft.id, {
          notes: `Imported from sheet — currency: ${currency} (sheet)`,
        })
      }

      // 2. For each row: create item, then write variants.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        updateStatus(i, { state: "creating", name: row.working_name })
        try {
          const { item } = await sourcing.createItem(draft.id, {
            working_name: row.working_name,
            source_type: "manual",
            cost_usd: row.cost_usd,
            notes: row.notes,
          })
          if (row.variants.length > 0) {
            await sourcing.replaceVariants(item.id, row.variants)
          }
          updateStatus(i, {
            state: "ok",
            name: row.working_name,
            itemId: item.id,
          })
        } catch (e) {
          updateStatus(i, {
            state: "failed",
            name: row.working_name,
            error: (e as Error).message ?? "unknown",
          })
        }
      }
    } catch (e) {
      setTopError((e as Error).message ?? "Failed to create draft")
    } finally {
      setCreating(false)
    }
  }

  const allOk =
    statuses.length > 0 && statuses.every((s) => s.state === "ok")
  const anyFailed = statuses.some((s) => s.state === "failed")

  function goToDraft() {
    if (draftId) {
      router.push(`/sourcing/${supplier.id}/drafts/${draftId}`)
    }
  }

  const totalPcs = rows.reduce(
    (acc, r) => acc + r.variants.reduce((a, v) => a + v.qty, 0),
    0,
  )
  const totalSpend = rows.reduce(
    (acc, r) =>
      acc + r.cost_usd * r.variants.reduce((a, v) => a + v.qty, 0),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="rounded border p-4 text-sm">
        <div>Supplier: <strong>{supplier.name}</strong></div>
        <div>Currency: <strong>{currency}</strong></div>
        <div>Items: <strong>{rows.length}</strong></div>
        <div>Total pcs: <strong>{totalPcs}</strong></div>
        <div>Total spend: <strong>${totalSpend.toFixed(2)}</strong></div>
      </div>

      {topError && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {topError}
        </div>
      )}

      {draftId && (
        <ul className="rounded border p-3 text-sm">
          {statuses.map((s, i) => (
            <li
              key={i}
              className="flex justify-between border-b py-1 last:border-b-0"
            >
              <span>{s.name}</span>
              <span className="text-xs">
                {s.state === "pending" && "⏳ queued"}
                {s.state === "creating" && "… creating"}
                {s.state === "ok" && (
                  <span className="text-green-700">✓ created</span>
                )}
                {s.state === "failed" && (
                  <span className="text-red-700">
                    ✗ {s.error}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={onBack}
          disabled={creating}
        >
          ← Back
        </button>
        {!draftId ? (
          <button
            type="button"
            className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={handleCreate}
            disabled={creating || rows.length === 0}
          >
            {creating ? "Creating…" : "Create draft"}
          </button>
        ) : (
          <button
            type="button"
            className="rounded bg-black px-4 py-2 text-sm text-white"
            onClick={goToDraft}
            disabled={creating}
          >
            {allOk
              ? "Go to draft →"
              : anyFailed
                ? "Open draft (some items failed) →"
                : "Open draft →"}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire ConfirmStep into ImportWizard**

Update `ImportWizard.tsx` to use it for the confirm stage:

```tsx
import { ConfirmStep } from "./steps/ConfirmStep"

// in JSX, replace confirm placeholder:
{stage === "confirm" && source && editableRows && (
  <ConfirmStep
    supplier={source.supplier}
    currency={source.currency}
    rows={editableRows}
    onBack={() => setStage("preview")}
  />
)}
```

- [ ] **Step 3: Typecheck**

```powershell
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```powershell
git add src/app/"(app)"/sourcing/import/steps/ConfirmStep.tsx src/app/"(app)"/sourcing/import/ImportWizard.tsx
git commit -m "feat(admin): ConfirmStep — orchestrates draft + items + variants, per-row status"
```

---

### Task 3.5 — Link to importer from sourcing index

**Files:**
- Modify: `dollup-admin/src/app/(app)/sourcing/page.tsx`

- [ ] **Step 1: Add a link button above the supplier table**

```tsx
// Modify the JSX returned by SourcingPage:
return (
  <div className="mx-auto w-full max-w-6xl px-4 py-6">
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold">Sourcing</h1>
      <a
        href="/sourcing/import"
        className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
      >
        Import from sheet
      </a>
    </div>
    <SupplierTable
      suppliers={suppliers}
      filter={filter}
      draftCounts={draftCounts}
    />
  </div>
)
```

- [ ] **Step 2: Typecheck**

```powershell
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```powershell
git add src/app/"(app)"/sourcing/page.tsx
git commit -m "feat(admin): link 'Import from sheet' from /sourcing index"
```

---

## Phase 4 — End-to-end smoke

### Task 4.1 — Local dev-server smoke against the real sheet

**Files:** none modified.

This task is manual verification. Don't skip it.

- [ ] **Step 1: Start backend (if not already running)**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
yarn dev
```

Wait for `Server ready on localhost:9000`.

- [ ] **Step 2: Start admin dev server in another shell**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npm run dev
```

- [ ] **Step 3: Log in and navigate to `/sourcing/import`**

Browser: open `http://localhost:3001/login` (or whatever port admin uses — check the terminal output), log in with the usual admin creds, navigate to `/sourcing`, click "Import from sheet".

- [ ] **Step 4: Paste the reference sheet (TSV from Google Sheets)**

Open the original sheet in Google Sheets, select all 17 rows (header + 16 items), copy, paste into the textarea.

Pick any active supplier, leave currency = USD, click **Parse →**.

**Expected preview-step state:**
- Items chip: `16 items`
- Variants chip: should match parser output (8 from row 9, 15 from row 15, etc. — exact count visible in tests; ~75)
- 0 unparseable
- Warnings only on row 14 (`qty mismatch: sheet says 14, variants sum to 12`)

- [ ] **Step 5: Click Continue → Create draft**

Watch the per-row status list. Expected: 16 `✓ created` rows, no failures.

- [ ] **Step 6: Click "Go to draft →"**

Confirm landing on `/sourcing/<supplierId>/drafts/<draftId>` with all 16 items visible, names "Item 1" through "Item 16", correct costs.

- [ ] **Step 7: Upload one image to one item via the existing UI**

Verifies the imported draft works with the rest of the sourcing pipeline.

- [ ] **Step 8: Record the result in the session log**

If everything passed, no further code changes. If any failure: file an inline-fix note describing exactly which row + step failed; come back to fix before moving on.

---

### Task 4.2 — Full backend test suite green check

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
yarn test:unit
```

Expected: all green, 50+ new tests inside `sheet-import.unit.spec.ts`.

- [ ] **Step 2: Run admin typecheck and lint (if configured)**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
npx tsc --noEmit
```

- [ ] **Step 3: Stop here if anything's red — fix before declaring done.**

---

## Phase 5 — Push

### Task 5.1 — Verify branches, then push both repos

**Files:** none modified.

- [ ] **Step 1: Confirm both repos on master with clean tree**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
git status
git log --oneline -10

cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
git status
git log --oneline -10
```

Expected: each repo shows the new commits ahead of origin/master.

- [ ] **Step 2: Push backend (await user confirmation before running)**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\Backend\dollup-medusa"
git push origin master
```

- [ ] **Step 3: Push admin (await user confirmation before running)**

```powershell
cd "c:\Users\rahvi\projects\DOLL UP BOUTIQUE\dollup-admin"
git push origin master
```

- [ ] **Step 4: Note the two new SHAs in `MEMORY.md`**

Update the auto-memory with a one-liner pointing at this feature plus the two commit SHAs, so future sessions can find it.

---

## Self-review

**Spec coverage — every spec section maps to tasks:**
- "Parser library" → Tasks 1.1–1.7
- "Parser must handle Xl/XXL, free size, multi-color" → Task 1.3 (sizes), 1.4 (colors), 1.6 (full row expansion)
- "Three input methods" → Task 2.2 (paste + xlsx helper), 3.2 (UI tabs)
- "3-step wizard" → Tasks 3.2–3.4
- "Lenient parser: partial rows import with warnings" → Task 1.7 (edge cases), 1.6 (qty-mismatch warning)
- "Existing UI takes over after import" → Task 3.4 (router.push to `/sourcing/<supplierId>/drafts/<id>`)
- "Tests covering all 16 rows" → Task 1.6
- "xlsx dep, only on the import page" → Task 2.2 (`await import("xlsx")` keeps it in a lazy chunk)
- "No DB migration" → confirmed; no migration in any task

**Spec items intentionally NOT implemented as separate tasks (re-checked):**
- "POST /admin/sourcing/import" was in the spec; the plan composes existing endpoints instead, because (a) it makes per-row progress feedback trivial, (b) it avoids a new endpoint duplicating supplier/draft/item creation logic, and (c) partial failure is naturally handled (some items created, user retries failed ones from the draft page). This is a deliberate scope tightening, not a missed requirement.

**Placeholder scan:** no TBDs, no "implement later", no "similar to Task N". Every code step shows the full code. Commands have expected output. ✅

**Type consistency:** `ParseResult` / `ParsedRow` / `ParsedVariant` / `EditableRow` names are used identically in all references. Service methods (`sourcing.createDraft`, `sourcing.createItem`, `sourcing.replaceVariants`, `sourcing.createSupplier`, `sourcing.listSuppliers`, `sourcing.updateDraft`) match the actual signatures in `dollup-admin/src/lib/admin-sourcing.ts`. ✅

**Risks worth flagging to the executor:**
1. Admin dev server port may not be 3001 — read the actual port from `npm run dev` output in Task 4.1 step 3.
2. `sourcing.createSupplier` response shape: the plan assumes `{ supplier }` — verify in `admin-sourcing.ts` if the test fails. If the actual shape is `{ data: ... }` or `{ id, name, ... }` directly, adjust the destructure in `SourceStep.handleCreateSupplier`.
3. The mirror parser strategy means any future parser change needs to land in both files. Acceptable for a one-shot feature with frozen scope. If we extend the parser later, consider extracting to a shared workspace package — out of scope here.
