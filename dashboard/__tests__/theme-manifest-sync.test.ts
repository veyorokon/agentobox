/**
 * Canonical theme manifest sync contract.
 *
 * Ensures the dashboard-generated manifest is a byte-for-byte projection of
 * the shared canonical manifest after the sync step runs.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(process.cwd(), "..")
const sourcePath = resolve(repoRoot, "shared/themes/builtins.json")
const generatedPath = resolve(repoRoot, "dashboard/generated/themes/builtins.json")

describe("theme manifest sync", () => {
  it("keeps the generated dashboard manifest aligned with the canonical source", () => {
    expect(readFileSync(generatedPath, "utf8")).toBe(readFileSync(sourcePath, "utf8"))
  })
})
