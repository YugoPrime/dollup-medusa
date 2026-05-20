# Sourcing: Sheet Import → DraftOrder

**Date:** 2026-05-21
**Status:** Spec, awaiting plan
**Touches:** `dollup-medusa` (parser lib + API route), `dollup-admin` (wizard page)

## Problem

The sourcing module (`Backend/dollup-medusa/src/modules/sourcing/`) currently assumes drafts are built inside the app — from Alibaba scrapes, PDF uploads, or manual entry. But several supplier orders are still mid-flight in pre-existing Google Sheets / xlsx files. There is no path to bring those into the module, so they can't benefit from ref allocation, cost edits, or the Stage B "push to Medusa" pipeline.

We need a one-shot importer that turns a sheet into a `DraftOrder` + `DraftItem`s + `DraftVariant`s the user can finish managing inside the existing UI.

## Scope

**In scope**
- Parse one sheet → one `DraftOrder` (`status = drafting`, currency from form).
- Per row → one `DraftItem`, with parsed variants on `DraftVariant`.
- Three input methods: pasted TSV/CSV (primary), uploaded `.csv`, uploaded `.xlsx`.
- 3-step wizard: source → preview/edit → confirm.
- Lenient parser: unparseable rows still import, flagged with warnings.

**Out of scope (YAGNI)**
- Image extraction from PDF/xlsx (images uploaded per-item via existing UI).
- Footer/total parsing (shipping, discount lines ignored).
- Re-import / sync against an existing draft.
- De-duplication vs prior drafts.
- Multi-sheet workbooks (only first sheet read).
- PDF parsing.

## Reference sheet (real data, 2026-04-06 supplier order)

Header: `Color | Size | Qty | unit price | total`. 16 line items. Examples:

| row | Color | Size | Qty | unit price |
|----:|-------|------|----:|-----------:|
| 1 | Brown | `3S,4M,3L` | 10 | 6.15 |
| 2 | _(blank)_ | `3S,3M,3L,3Xl` | 12 | 4.15 |
| 9 | `Brugandy, White,` | `3S,3M,2L,2Xl` | 20 | 5.47 |
| 10 | _(blank)_ | `free size 3 each` | 12 | 2.69 |
| 14 | _(blank)_ | `3S,3M,2L,2Xl, 2XL` | 14 | 7.08 |
| 15 | `Black, White, Light Yellow` | `2XS,2S,2M,2L,2XL` | 30 | 5.47 |
| 16 | `BLACK ` | `3S,4M,3L` | 10 | 6.43 |

Behaviour the parser must handle:
- Leading digits in size tokens = per-size qty (`3S` → 3 units of size S).
- Mixed `Xl` and `2XL` in one cell (row 14): `Xl/xl` → `XL`, `2XL`/`xxl` → `XXL`.
- Multi-color rows expand to `colors × sizes` variants; row qty splits evenly across colors.
- `free size N each` → one variant `OS × (row qty)` (or N per color if multi-color). Raw cell preserved in item notes.
- Trailing commas, stray spaces, mixed case allowed.

## Architecture

### Backend — parser library (pure)

`src/modules/sourcing/lib/sheet-import.ts`

```ts
export type ParsedVariant = {
  color: string | null
  size: string
  qty: number
}

export type ParsedRow = {
  row_index: number       // 1-based from header
  working_name: string    // "Item N" placeholder
  cost_usd: number
  qty_total: number       // raw from Qty column
  notes: string | null    // raw size cell if non-standard (e.g. "free size 3 each")
  variants: ParsedVariant[]
  warnings: string[]      // e.g. "row qty mismatch: sheet=20, parsed=18"
}

export type ParseResult = {
  header_row_index: number
  rows: ParsedRow[]
  unparseable: Array<{ row_index: number; raw: string[]; reason: string }>
}

export function parseSourcingSheet(rows: string[][]): ParseResult
export function parseSizeCell(raw: string): Array<{ size: string; qty: number }>
export function parseColorCell(raw: string): Array<string | null>  // [null] when blank
export function normalizeSizeLabel(token: string): string          // "Xl"→"XL", "2XL"→"XXL", etc.
```

**Header detection:** find the first row whose lowercased+trimmed cells contain `size`, `qty`, and any of `unit price` / `price` / `cost`. Map columns by header name (resilient to column order).

**Size normalization table:**
| Input (case-insensitive) | Normalized |
|--------------------------|------------|
| `xs`, `x-s` | XS |
| `s` | S |
| `m` | M |
| `l` | L |
| `xl`, `x-l`, `1x`, `1xl` | XL |
| `xxl`, `2xl`, `xx-l` | XXL |
| `xxxl`, `3xl` | XXXL |
| `os`, `free size`, `freesize`, `one size` | OS |

For tokens that don't match: keep the original (uppercased), append a warning to the row.

**Variant expansion:**
- `colors = parseColorCell(row.Color)` (defaults to `[null]`).
- `sizes = parseSizeCell(row.Size)` (list of `{size, qty}`).
- If `sizes.length === 0` and `colors.length === 1`: one variant with `size = "OS"`, `qty = row.Qty`.
- Multi-color split: each color gets `sizes` with `qty = sizeToken.qty` (NOT divided again). Validation: `sum(variants.qty)` should equal `row.Qty × colors.length / colors.length` → simply `sum(sizeTokenQtys) × colors.length`. If mismatch with `row.Qty`, append warning but keep variants.

### Backend — API route

`src/api/admin/sourcing/import/route.ts`

```
POST /admin/sourcing/import
Body: {
  supplier_id: string
  currency: string                  // default "USD"
  rows: ParsedRow[]                 // edited in preview before submit
  notes?: string                    // optional draft-level note
}
Response: { draft_order_id: string }
```

Server logic:
1. Auth (admin).
2. Validate `supplier_id` exists (else 400).
3. `service.createDraftOrder({ supplier_id, currency, notes })`.
4. For each `ParsedRow` (already validated client-side): `service.createDraftItem(...)` then bulk `createDraftVariant`s.
5. Return draft id.

Reuses existing sourcing service methods — no new service methods needed if the current `service.ts` exposes create operations for item/variant. (If it only exposes higher-level "scrape" creators, add thin pass-through methods — to be confirmed in the plan phase.)

### Admin — wizard page

`src/routes/sourcing/import/page.tsx`

**Step 1: Source**
- Supplier dropdown (existing `/admin/sourcing/suppliers` list) + inline "New supplier" button (opens existing supplier form).
- Currency input (default `USD`).
- Tabs: `Paste TSV/CSV` (textarea, primary) | `Upload file` (.csv / .xlsx).
- `[Parse]` button → runs `parseSourcingSheet` client-side (browser-safe pure function, no Node deps). For xlsx, uses dynamically-imported `xlsx` (lazy chunk).

**Step 2: Preview & edit**
- Summary chips: `N items parsed`, `M unparseable`, `K warnings`.
- Editable table per row: name | color list | size cell | qty | cost | notes | warnings.
- Editing a cell re-runs that row through the parser; warnings update live.
- Unparseable rows shown in a collapsed section — user can click "convert to item" and fill manually, or leave skipped.
- `[Back]` / `[Continue]`.

**Step 3: Confirm**
- Read-only summary: supplier, currency, total items, total variants, total spend (`Σ qty × cost`).
- `[Create draft]` → POSTs to `/admin/sourcing/import` → redirects to `/sourcing/drafts/<id>`.

### Dependencies

`dollup-admin/package.json`: add `xlsx@^0.20` (or current stable, ~600 KB, vetted, only loaded lazily on the import page). No backend dependency change.

## Data flow

```
xlsx/csv/tsv  ──(client parse)──►  ParseResult
       (user edits in preview)            │
                                          ▼
                          POST /admin/sourcing/import
                                          │
                                          ▼
                              service.createDraftOrder
                              service.createDraftItem  (xN)
                              service.createDraftVariant (xK)
                                          │
                                          ▼
                               redirect /sourcing/drafts/<id>
                                  (existing UI takes over)
```

## Error handling

| Condition | Behaviour |
|-----------|-----------|
| No supplier selected | Disable `[Parse]` / show field error |
| Empty paste / empty file | Step 2 shows "No rows found"; user goes back |
| Header row not found | Surface "Couldn't find Size + Qty columns" with row dump for debugging |
| Row missing Qty or Size | Goes into `unparseable[]` with reason; rest of import continues |
| Size token doesn't match table | Variant created with uppercased raw token + row warning chip |
| Color cell has stray comma / spaces | Trimmed silently, no warning |
| Server `createDraftItem` fails mid-import | DraftOrder + already-created items are kept (no rollback); error toast with last-successful row index. User can delete the partial draft and retry. |

We deliberately skip transactional rollback — partial drafts are easier to debug than lost work, and the existing `/sourcing/drafts/<id>` page already supports item delete/recreate.

## Testing

**Unit (`src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`)**
- `parseSizeCell` covering: `3S,4M,3L` / `3S,3M,2L,2Xl` / `3S,3M,2L,2Xl,2XL` / `free size 3 each` / empty / `,,` / mixed case
- `parseColorCell` covering: blank / `Brown` / `Brugandy, White,` / `Black, White, Light Yellow` / trailing comma
- `normalizeSizeLabel` table-driven across the normalization table
- `parseSourcingSheet` end-to-end on a fixture made from the real 16-row sheet → assert exact `ParsedRow[]` (variant count per row, qty sums, warnings on the right rows)

**Integration (`src/api/admin/sourcing/import/__tests__/route.spec.ts`)**
- POST with valid payload → 200, draft + items + variants exist in DB with correct counts.
- POST with missing supplier_id → 400.
- POST with empty `rows` → 400.

**Manual smoke**
- Paste full 16-row sheet → step 2 shows exactly 16 items, expected variant count (~78), zero unparseable, warnings only on rows 9/14/15 if any.
- Confirm → land on `/sourcing/drafts/<id>` with all items visible.
- Upload one item image via existing UI; Stage B push that one item end-to-end to a Medusa product as smoke.

## Migration / rollout

- No DB migration needed (uses existing tables).
- New endpoint is admin-only, additive — no existing flow affected.
- New admin page is a leaf route, additive.
- Deploy together: backend route + admin page in one branch.

## Files

**Backend (`dollup-medusa`)**
- ➕ `src/modules/sourcing/lib/sheet-import.ts` (~200 LOC pure)
- ➕ `src/modules/sourcing/__tests__/sheet-import.unit.spec.ts`
- ➕ `src/api/admin/sourcing/import/route.ts` (~80 LOC)
- ➕ `src/api/admin/sourcing/import/__tests__/route.spec.ts`

**Admin (`dollup-admin`)**
- ➕ `src/routes/sourcing/import/page.tsx` (wizard, ~300 LOC across small subcomponents)
- ➕ `src/routes/sourcing/import/lib/sheet-import.ts` (re-export or duplicate of pure parser — see plan for which)
- ✏️ link to import wizard from existing `/sourcing` index page
- ✏️ `package.json` add `xlsx`

## Open for the planning phase

- Whether the parser lives in the backend repo and the admin imports it from a published path, or is duplicated (admin doesn't currently consume from `dollup-medusa` directly). Likely simplest: copy the file into admin too, since it's pure and small.
- Confirm existing `service.ts` exposes create methods we can call from the new route, or if we need to wrap them.
