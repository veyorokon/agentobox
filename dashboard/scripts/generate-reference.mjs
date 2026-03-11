/**
 * Generate docs/DASHBOARD-REFERENCE.md from dashboard codebase.
 *
 * Extracts file-level JSDoc comments (module docstrings), test descriptions
 * (describe/it strings), and intentional/tech-debt annotations from .ts/.tsx
 * files. Mirrors the backend pattern in generate_reference.py.
 *
 * Usage:
 *     node dashboard/scripts/generate-reference.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import { join, relative, extname } from "node:path"

const SCRIPT_DIR = new URL(".", import.meta.url).pathname
const DASHBOARD_DIR = join(SCRIPT_DIR, "..")
const REPO_ROOT = join(DASHBOARD_DIR, "..")
const OUTPUT_PATH = join(REPO_ROOT, "docs", "DASHBOARD-REFERENCE.md")

const SKIP_DIRS = new Set(["node_modules", ".next", "__pycache__", ".turbo", "dist"])
const TS_EXTS = new Set([".ts", ".tsx"])

// ── Helpers ──────────────────────────────────────────────────────────────

function walkFiles(dir, exts) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries.sort()) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        results.push(...walkFiles(full, exts))
      }
    } else if (exts.has(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

function relPath(absPath) {
  return relative(REPO_ROOT, absPath)
}

// ── Extractors ───────────────────────────────────────────────────────────

/**
 * Extract the first JSDoc block if it starts at the very top of the file
 * (possibly preceded by blank lines or single-line comments like "use client").
 * Returns { content, line } or null.
 */
function extractFileJSDoc(src) {
  // Find the first /** ... */ block. It must appear before any import/export
  // or code statement to count as a "module docstring".
  const match = src.match(/^((?:\s*(?:\/\/[^\n]*)?\n)*)\s*(\/\*\*[\s\S]*?\*\/)/)
  if (!match) return null

  const preamble = match[1]
  const block = match[2]

  // Ensure nothing code-like precedes it (only whitespace, single-line comments,
  // or "use client"/"use server" directives are allowed before the JSDoc).
  const preambleLines = preamble.split("\n")
  for (const line of preambleLines) {
    const trimmed = line.trim()
    if (
      trimmed === "" ||
      trimmed.startsWith("//") ||
      /^["']use (client|server)["'];?$/.test(trimmed)
    ) {
      continue
    }
    // Something else precedes the JSDoc — not a file-level docstring
    return null
  }

  // Strip the /** and */ delimiters and leading " * " from each line
  const inner = block
    .replace(/^\/\*\*\s*/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim()

  if (!inner) return null

  // Line number of the opening /**
  const line = preamble.split("\n").length
  return { content: inner, line }
}

/**
 * Extract // intentional: and // tech-debt: annotations.
 * Best-effort skip of comments inside string literals.
 */
function extractAnnotations(src, filePath) {
  const chunks = []
  const lines = src.split("\n")
  const pattern = /\/\/\s*(intentional|tech-debt):\s*(.+)/

  // Build a set of line numbers that are inside template literals or
  // multi-line strings. This is best-effort — no full parser.
  const inString = new Set()
  let inTemplateLiteral = false
  let braceDepth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Very rough: track backtick-delimited regions
    const backticks = (line.match(/`/g) || []).length
    if (inTemplateLiteral) {
      inString.add(i + 1)
      if (backticks % 2 === 1) inTemplateLiteral = false
    } else if (backticks % 2 === 1) {
      // Opens a template literal that doesn't close on this line
      // But if it also closes, it's a single-line template — don't mark
      inTemplateLiteral = true
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (inString.has(i + 1)) continue
    const match = pattern.exec(lines[i])
    if (!match) continue

    const tag = match[1]
    const reason = match[2].trim()
    const rel = relPath(filePath)
    const lineNo = i + 1
    chunks.push({
      fileName: filePath.split("/").pop(),
      lineNo,
      content: reason,
      source: `${rel}:${lineNo}`,
      type: tag === "intentional" ? "annotation" : "tech_debt",
    })
  }
  return chunks
}

/**
 * Extract describe("...", ...) and it("...", ...) strings from test files.
 * Returns nested structure: [{ describe, its: [...] }]
 */
function extractTestDescriptions(src, filePath) {
  const chunks = []
  const rel = relPath(filePath)

  // Match describe("...", and it("...", at statement level (leading whitespace only).
  // The (?:^|\n) anchor + optional whitespace prevents matching .split("\n") etc.
  const describeRe = /(?:^|\n)\s*describe\(\s*["'`]((?:[^"'`\\]|\\.)*)["'`]/g
  const itRe = /(?:^|\n)\s*it\(\s*["'`]((?:[^"'`\\]|\\.)*)["'`]/g

  let match
  while ((match = describeRe.exec(src)) !== null) {
    const lineNo = src.slice(0, match.index).split("\n").length
    chunks.push({
      text: match[1],
      lineNo,
      source: `${rel}:${lineNo}`,
      kind: "describe",
    })
  }
  while ((match = itRe.exec(src)) !== null) {
    const lineNo = src.slice(0, match.index).split("\n").length
    chunks.push({
      text: match[1],
      lineNo,
      source: `${rel}:${lineNo}`,
      kind: "it",
    })
  }
  return chunks
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const allFiles = walkFiles(DASHBOARD_DIR, TS_EXTS)
  const modules = []
  const annotations = []
  const techDebt = []
  const testPrinciples = [] // grouped by file

  for (const filePath of allFiles) {
    const rel = relPath(filePath)
    let src
    try {
      src = readFileSync(filePath, "utf-8")
    } catch {
      continue
    }

    // Skip test files for module docstrings and annotations
    const isTest =
      rel.includes("__tests__") ||
      filePath.endsWith(".test.ts") ||
      filePath.endsWith(".test.tsx")

    // Module docstrings (non-test files only)
    if (!isTest) {
      const doc = extractFileJSDoc(src)
      if (doc) {
        modules.push({
          title: rel,
          content: doc.content,
          source: `${rel}:${doc.line}`,
        })
      }
    }

    // Annotations (non-test files only)
    if (!isTest) {
      const annots = extractAnnotations(src, filePath)
      for (const a of annots) {
        if (a.type === "annotation") annotations.push(a)
        else techDebt.push(a)
      }
    }

    // Test descriptions (test files only)
    if (isTest) {
      const descs = extractTestDescriptions(src, filePath)
      if (descs.length > 0) {
        // Also extract file-level JSDoc as test file summary
        const doc = extractFileJSDoc(src)
        testPrinciples.push({
          file: rel,
          summary: doc ? doc.content : null,
          descriptions: descs,
        })
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const lines = [
    "# Agentobox Dashboard Reference",
    "",
    "> Auto-generated from codebase. Do not edit — regenerate with `node dashboard/scripts/generate-reference.mjs`.",
    "",
  ]

  // Modules
  if (modules.length > 0) {
    lines.push("## Modules")
    lines.push("")
    for (const mod of modules) {
      lines.push(`### ${mod.title}`)
      lines.push("")
      lines.push(mod.content)
      lines.push("")
    }
  }

  // Test Principles
  if (testPrinciples.length > 0) {
    lines.push("## Test Principles")
    lines.push("")
    for (const tp of testPrinciples) {
      lines.push(`### ${tp.file}`)
      lines.push("")
      if (tp.summary) {
        lines.push(tp.summary)
        lines.push("")
      }
      // Group: describe blocks with their it() children
      const describes = tp.descriptions.filter((d) => d.kind === "describe")
      const its = tp.descriptions.filter((d) => d.kind === "it")

      if (describes.length > 0) {
        for (const desc of describes) {
          lines.push(`**${desc.text}**`)
          // Find it() blocks that appear after this describe and before the next
          const nextDescLine =
            describes.find((d) => d.lineNo > desc.lineNo)?.lineNo ?? Infinity
          const childIts = its.filter(
            (i) => i.lineNo > desc.lineNo && i.lineNo < nextDescLine
          )
          if (childIts.length > 0) {
            for (const it of childIts) {
              lines.push(`- ${it.text}`)
            }
          }
          lines.push("")
        }
      } else if (its.length > 0) {
        // Standalone it() blocks without describe wrapper
        for (const it of its) {
          lines.push(`- ${it.text}`)
        }
        lines.push("")
      }
    }
  }

  // Exception Annotations
  if (annotations.length > 0) {
    lines.push("## Exception Annotations")
    lines.push("")
    lines.push("| File | Line | Annotation |")
    lines.push("|------|------|------------|")
    for (const a of annotations) {
      lines.push(`| ${a.fileName} | ${a.lineNo} | ${a.content} |`)
    }
    lines.push("")
  }

  // Tech Debt
  if (techDebt.length > 0) {
    lines.push("## Tech Debt")
    lines.push("")
    lines.push("| File | Line | Annotation |")
    lines.push("|------|------|------------|")
    for (const a of techDebt) {
      lines.push(`| ${a.fileName} | ${a.lineNo} | ${a.content} |`)
    }
    lines.push("")
  }

  const content = lines.join("\n")

  mkdirSync(join(REPO_ROOT, "docs"), { recursive: true })
  writeFileSync(OUTPUT_PATH, content, "utf-8")

  const totalChunks =
    modules.length +
    testPrinciples.length +
    annotations.length +
    techDebt.length
  process.stderr.write(
    `Wrote ${OUTPUT_PATH} (${totalChunks} chunks: ${modules.length} modules, ${testPrinciples.length} test files, ${annotations.length} annotations, ${techDebt.length} tech-debt)\n`
  )
}

main()
