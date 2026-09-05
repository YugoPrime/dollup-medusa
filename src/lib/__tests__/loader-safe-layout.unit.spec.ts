import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Medusa's ResourceLoader requires EVERY file under src/subscribers and
 * src/jobs at boot, recursively, except basenames starting with "_".
 * A Jest spec placed there crashes production with "jest is not defined"
 * (happened 2026-09-05). Tests for subscribers and jobs live in
 * src/lib/__tests__ instead.
 */
const LOADED_DIRS = ["src/subscribers", "src/jobs"]
const ROOT = join(__dirname, "..", "..", "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe("Medusa-loaded directories contain no test files", () => {
  it.each(LOADED_DIRS)("%s has no *.spec.* / *.test.* files the loader would require", (dir) => {
    const offenders = walk(join(ROOT, dir))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f))
      .filter((f) => !/\/_[^/]*$/.test(f))
    expect(offenders).toEqual([])
  })
})
