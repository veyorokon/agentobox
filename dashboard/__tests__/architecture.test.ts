/**
 * Frontend architecture enforcement tests.
 *
 * Static analysis — reads source files and checks structural patterns.
 * No React rendering, no DOM, no browser. Just file scanning with regex.
 *
 * Principles enforced:
 *  1. Zustand stores hold only client UI state — never server data
 *  2. Apollo hooks follow naming conventions and use the unified logger
 *  3. Components subscribe directly to stores/hooks — no prop drilling
 *  4. Bridge hooks are the only place cross-entity cache mutations happen
 *  5. All zustand stores use the logging middleware
 */

import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"

const DASHBOARD = path.resolve(__dirname, "..")
const STORES_DIR = path.join(DASHBOARD, "lib/stores")
const HOOKS_DIR = path.join(DASHBOARD, "lib/graphql/hooks")
const COMPONENTS_DIR = path.join(DASHBOARD, "components")

/* ── Helpers ──────────────────────────────────────────────────────── */

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8")
}

function globTs(dir: string, pattern = "**/*.{ts,tsx}"): string[] {
  return walkDir(dir).filter((f) => /\.(ts|tsx)$/.test(f))
}

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...walkDir(full))
    else files.push(full)
  }
  return files
}

function relPath(filePath: string): string {
  return path.relative(DASHBOARD, filePath)
}

/* ── Tests ────────────────────────────────────────────────────────── */

describe("Zustand Store Principles", () => {
  const storeFiles = globTs(STORES_DIR).filter(
    (f) => !f.includes("log-middleware") && !f.includes("__tests__")
  )

  it("stores never import from @apollo/client", () => {
    const violations: string[] = []
    for (const file of storeFiles) {
      const src = readFile(file)
      if (/@apollo\/client/.test(src)) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Zustand stores must not import Apollo: ${violations.join(", ")}`).toEqual([])
  })

  it("stores never import server data types (Agent, TeamFeedItem, Skill)", () => {
    // Server-owned types that should never appear in zustand store imports
    // Check import statements, not field names (Agent appears in agentSearch etc)
    const serverTypeImport = /import\s+.*\b(Agent|TeamFeedItem|Skill|McpRegistryServer|AgentTask)\b.*from/
    const violations: string[] = []
    for (const file of storeFiles) {
      const src = readFile(file)
      const lines = src.split("\n")
      for (const line of lines) {
        const match = line.match(serverTypeImport)
        if (match) {
          violations.push(`${relPath(file)}: imports server type "${match[1]}"`)
        }
      }
    }
    expect(violations, `Zustand stores must not import server data types:\n${violations.join("\n")}`).toEqual([])
  })

  it("all stores use the zustandLog middleware", () => {
    const violations: string[] = []
    for (const file of storeFiles) {
      const src = readFile(file)
      // Must have zustandLog import and use it in create()
      if (!src.includes("zustandLog")) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Stores without logging middleware: ${violations.join(", ")}`).toEqual([])
  })

  it("store exports follow use<Name>Store naming convention", () => {
    const violations: string[] = []
    for (const file of storeFiles) {
      const src = readFile(file)
      const exports = src.match(/export const (\w+)/g) ?? []
      for (const exp of exports) {
        const name = exp.replace("export const ", "")
        if (!name.startsWith("use") || !name.endsWith("Store")) {
          violations.push(`${relPath(file)}: export "${name}" should be use<Name>Store`)
        }
      }
    }
    expect(violations, `Store naming violations:\n${violations.join("\n")}`).toEqual([])
  })
})

describe("Apollo Hook Principles", () => {
  const hookFiles = globTs(HOOKS_DIR)

  it("all hook files use the unified logger", () => {
    const violations: string[] = []
    for (const file of hookFiles) {
      const src = readFile(file)
      if (!src.includes("createLogger")) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Hook files without logger: ${violations.join(", ")}`).toEqual([])
  })

  it("query hooks follow use<Domain> naming convention", () => {
    const violations: string[] = []
    for (const file of hookFiles) {
      const src = readFile(file)
      // Find exported functions that return useQuery results
      const queryHooks = [...src.matchAll(/export function (use\w+)\(\)/g)]
      for (const [, name] of queryHooks) {
        // Skip subscription, mutation, and bridge hooks — only check pure query hooks
        if (name.includes("Subscription") || name.includes("Resolve") || name.includes("Send")
            || name.includes("Set") || name.includes("Kill") || name.includes("Remove")
            || name.includes("Restart") || name.includes("Interrupt") || name.includes("Acknowledge")
            || name.includes("Create") || name.includes("Update") || name.includes("Delete")
            || name.includes("Hard")) continue
        // Query hooks should be use<Domain> (short, no verb prefix)
        // Allow compound domain names like useMcpSearch, useAgentFeed
        const verbPrefixes = /^use(Get|Fetch|Load|Find|Check|Validate)/
        if (verbPrefixes.test(name)) {
          violations.push(`${relPath(file)}: "${name}" — query hooks should be use<Domain> (no verb prefix)`)
        }
      }
    }
    expect(violations, `Hook naming violations:\n${violations.join("\n")}`).toEqual([])
  })

  it("bridge hooks follow useResolve<Action> naming convention", () => {
    const violations: string[] = []
    for (const file of hookFiles) {
      const src = readFile(file)
      // Find functions that modify multiple cache entity types
      // Bridge hooks should be named useResolve<Action>
      const resolveFns = [...src.matchAll(/export function (use\w*Resolve\w+)/g)]
      for (const [, name] of resolveFns) {
        if (!/^useResolve[A-Z]/.test(name)) {
          violations.push(`${relPath(file)}: "${name}" — bridge hooks should be useResolve<Action>`)
        }
      }
    }
    expect(violations, `Bridge hook naming violations:\n${violations.join("\n")}`).toEqual([])
  })

  it("hook files never import from zustand stores", () => {
    const violations: string[] = []
    for (const file of hookFiles) {
      const src = readFile(file)
      if (/from\s+["']@\/lib\/stores\//.test(src)) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Apollo hooks must not import zustand stores: ${violations.join(", ")}`).toEqual([])
  })
})

describe("Component Architecture", () => {
  const componentFiles = globTs(COMPONENTS_DIR)
  const pageFile = path.join(DASHBOARD, "app/p/[projectId]/page.tsx")

  it("no component imports writeQuery from Apollo", () => {
    // writeQuery is only for initial seeding, never in components
    const violations: string[] = []
    for (const file of componentFiles) {
      const src = readFile(file)
      if (/writeQuery/.test(src)) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Components must not use writeQuery (seed at module scope only): ${violations.join(", ")}`).toEqual([])
  })

  it("subscriptions are only called from the page component", () => {
    // Subscription hooks should only be called from the page-level component
    const subscriptionPattern = /use\w+Subscription\(\)/
    const violations: string[] = []
    for (const file of componentFiles) {
      const src = readFile(file)
      if (subscriptionPattern.test(src)) {
        violations.push(relPath(file))
      }
    }
    expect(
      violations,
      `Subscription hooks must only be called from page component, not:\n${violations.join("\n")}`
    ).toEqual([])
  })

  it("page component is a layout shell (no direct cache.modify)", () => {
    if (!fs.existsSync(pageFile)) return
    const src = readFile(pageFile)
    expect(src).not.toMatch(/cache\.modify/)
  })

  it("components never call cache.modify directly (only hooks can)", () => {
    const violations: string[] = []
    for (const file of componentFiles) {
      const src = readFile(file)
      if (/cache\.modify\s*\(/.test(src)) {
        violations.push(relPath(file))
      }
    }
    expect(
      violations,
      `cache.modify belongs in hooks, not components:\n${violations.join("\n")}`
    ).toEqual([])
  })

  it("zustand store hooks always use selectors (no bare useXStore() calls)", () => {
    // useXStore() without a selector subscribes to the entire store — every
    // state change triggers a re-render. Always use useXStore(s => s.field).
    const bareStoreCall = /use\w+Store\(\)/
    const violations: string[] = []
    const allFiles = [...componentFiles, ...globTs(path.join(DASHBOARD, "app"))]
    for (const file of allFiles) {
      const src = readFile(file)
      const lines = src.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (bareStoreCall.test(lines[i])) {
          violations.push(`${relPath(file)}:${i + 1}: ${lines[i].trim()}`)
        }
      }
    }
    expect(
      violations,
      `Bare useXStore() calls cause unnecessary re-renders. Use useXStore(s => s.field):\n${violations.join("\n")}`
    ).toEqual([])
  })
})

describe("Logging Discipline", () => {
  it("zustand log-middleware uses createLogger", () => {
    const middleware = path.join(STORES_DIR, "log-middleware.ts")
    if (!fs.existsSync(middleware)) {
      expect.fail("log-middleware.ts must exist in stores/")
    }
    const src = readFile(middleware)
    expect(src).toMatch(/createLogger/)
  })

  it("every apollo hooks file initializes a logger", () => {
    const hookFiles = globTs(HOOKS_DIR)
    const violations: string[] = []
    for (const file of hookFiles) {
      const src = readFile(file)
      // Should have createLogger("apollo") or similar at module scope
      if (!src.includes('createLogger(')) {
        violations.push(relPath(file))
      }
    }
    expect(violations, `Hook files missing logger initialization: ${violations.join(", ")}`).toEqual([])
  })
})

describe("Naming Conventions", () => {
  it("hook files are named use-<domain>.ts", () => {
    const hookFiles = globTs(HOOKS_DIR)
    const violations: string[] = []
    for (const file of hookFiles) {
      const basename = path.basename(file)
      if (!basename.startsWith("use-")) {
        violations.push(basename)
      }
    }
    expect(violations, `Hook files must be named use-<domain>.ts: ${violations.join(", ")}`).toEqual([])
  })

  it("store files dont have use- prefix (files are <domain>.ts, exports are use<Domain>Store)", () => {
    const storeFiles = globTs(STORES_DIR).filter((f) => !f.includes("log-middleware"))
    const violations: string[] = []
    for (const file of storeFiles) {
      const basename = path.basename(file)
      if (basename.startsWith("use-")) {
        violations.push(basename)
      }
    }
    expect(violations, `Store files should be <domain>.ts not use-<domain>.ts: ${violations.join(", ")}`).toEqual([])
  })
})
