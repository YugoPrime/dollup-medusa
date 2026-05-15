/**
 * DollUp Boutique — WooCommerce customer import (Option A: silent)
 *
 * Reads a CSV of {email, first_name, last_name}, fixes double-encoded UTF-8
 * mojibake (e.g. "AurÃ©lie" -> "Aurélie"), de-dupes against existing Medusa
 * customers, and bulk-creates the rest with no auth identity.
 *
 * Customers land with has_account=false and metadata.source="woocommerce_import"
 * so a later "claim your account" email blast can target this cohort.
 *
 * Run (dry, no writes):
 *   WOO_IMPORT_DRY_RUN=1 yarn medusa exec ./src/scripts/import-woo-customers.ts
 *
 * Run (live):
 *   yarn medusa exec ./src/scripts/import-woo-customers.ts
 *
 * Override CSV location:
 *   WOO_CUSTOMERS_CSV=/path/to/file.csv yarn medusa exec ./src/scripts/import-woo-customers.ts
 */
import { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import * as fs from "fs";
import * as path from "path";

const BATCH_SIZE = 50;
const EXISTING_LOOKUP_BATCH = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TODAY = new Date().toISOString().slice(0, 10);
// Detect any byte in 0x80-0xFF — needed for mojibake re-decode
const HIGH_BYTE_RE = /[-ÿ]/;

type Row = { email: string; first_name: string; last_name: string };

function fixMojibake(s: string): string {
  if (!s || !HIGH_BYTE_RE.test(s)) return s;
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

function parseCsv(raw: string): Row[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const email = parts[0].trim().toLowerCase();
    const first_name = parts[1].trim();
    // last_name may itself contain commas — join the tail back together
    const last_name = parts.slice(2).join(",").trim();
    rows.push({ email, first_name, last_name });
  }
  return rows;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default async function importWooCustomers({ container }: ExecArgs) {
  const logger = container.resolve("logger" as any) as any;
  const customerService = container.resolve(Modules.CUSTOMER);

  const dryRun = process.env.WOO_IMPORT_DRY_RUN === "1";
  const csvPath = process.env.WOO_CUSTOMERS_CSV
    ? path.resolve(process.env.WOO_CUSTOMERS_CSV)
    : path.resolve(process.cwd(), "..", "..", "dollup-customers-emails.csv");

  logger.info(`[woo-import] mode=${dryRun ? "DRY RUN" : "LIVE"}  csv=${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found at ${csvPath}. Set WOO_CUSTOMERS_CSV to override.`);
  }

  const rawText = fs.readFileSync(csvPath, "utf8");
  const parsed = parseCsv(rawText);
  logger.info(`[woo-import] parsed ${parsed.length} rows from CSV`);

  const seen = new Set<string>();
  const cleaned: Row[] = [];
  const stats = {
    raw: parsed.length,
    invalidEmail: 0,
    testRows: 0,
    duplicateInFile: 0,
    cleaned: 0,
  };

  for (const r of parsed) {
    if (!EMAIL_RE.test(r.email)) {
      stats.invalidEmail++;
      continue;
    }
    const fn = r.first_name.toLowerCase();
    const ln = r.last_name.toLowerCase();
    if (fn === "test" && (ln === "tets" || ln === "test")) {
      stats.testRows++;
      continue;
    }
    if (seen.has(r.email)) {
      stats.duplicateInFile++;
      continue;
    }
    seen.add(r.email);
    cleaned.push({
      email: r.email,
      first_name: fixMojibake(r.first_name),
      last_name: fixMojibake(r.last_name),
    });
  }
  stats.cleaned = cleaned.length;
  logger.info(
    `[woo-import] cleaned=${stats.cleaned}  invalid=${stats.invalidEmail}  test=${stats.testRows}  dup_in_file=${stats.duplicateInFile}`
  );

  const existingEmails = new Set<string>();
  for (const batch of chunk(cleaned, EXISTING_LOOKUP_BATCH)) {
    const found = await customerService.listCustomers(
      { email: batch.map((r) => r.email) },
      { select: ["email"], take: batch.length }
    );
    for (const c of found) existingEmails.add(c.email.toLowerCase());
  }
  logger.info(`[woo-import] already in Medusa: ${existingEmails.size}`);

  const toCreate = cleaned.filter((r) => !existingEmails.has(r.email));
  logger.info(`[woo-import] to create: ${toCreate.length}`);

  if (dryRun) {
    logger.info("[woo-import] DRY RUN — skipping createCustomers");
    const sample = toCreate.slice(0, 5).map((r) => `${r.email} | ${r.first_name} | ${r.last_name}`);
    logger.info(`[woo-import] sample:\n  ${sample.join("\n  ")}`);
    return;
  }

  let created = 0;
  const failures: Array<{ email: string; error: string }> = [];

  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    const payload = batch.map((r) => ({
      email: r.email,
      first_name: r.first_name || undefined,
      last_name: r.last_name || undefined,
      has_account: false,
      metadata: {
        source: "woocommerce_import",
        imported_at: TODAY,
      },
    }));
    try {
      const result = await customerService.createCustomers(payload);
      created += Array.isArray(result) ? result.length : 1;
      logger.info(`[woo-import] created ${created}/${toCreate.length}`);
    } catch (err: any) {
      logger.warn(`[woo-import] batch failed (${err?.message ?? err}); retrying individually`);
      for (const one of payload) {
        try {
          await customerService.createCustomers([one] as any);
          created++;
        } catch (innerErr: any) {
          failures.push({ email: one.email, error: innerErr?.message ?? String(innerErr) });
        }
      }
    }
  }

  logger.info(`[woo-import] DONE  created=${created}  failed=${failures.length}`);
  if (failures.length > 0) {
    const logPath = path.resolve(process.cwd(), `woo-import-failures-${TODAY}.json`);
    fs.writeFileSync(logPath, JSON.stringify(failures, null, 2));
    logger.warn(`[woo-import] failures written to ${logPath}`);
  }
}
