/**
 * Theme registry contract tests.
 *
 * Ensures the frontend resolves one full token set from the canonical theme
 * registry and applies it directly to CSS variables on the document.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest"

import {
  DEFAULT_THEME,
  applyThemeConfigToDocument,
  resolveThemeConfig,
} from "@/lib/theme-registry"

describe("theme registry", () => {
  it("resolves a built-in theme to a full token set", () => {
    const resolved = resolveThemeConfig({ theme: "nord", mode: "dark" })

    expect(resolved.tokens?.surface).toBe("#2e3440")
    expect(resolved.tokens?.["border-default"]).toBe("rgba(76, 86, 106, 0.50)")
    expect(resolved.tokens?.["radius-md"]).toBe("0.375rem")
  })

  it("overlays custom tokens onto the default baseline", () => {
    const resolved = resolveThemeConfig({
      theme: "custom",
      mode: "dark",
      tokens: {
        accent: "#ff00aa",
        "text-default": "#ffffff",
      },
    })

    expect(resolved.tokens?.accent).toBe("#ff00aa")
    expect(resolved.tokens?.["text-default"]).toBe("#ffffff")
    expect(resolved.tokens?.surface).toBe(DEFAULT_THEME.tokens.surface)
    expect(resolved.tokens?.["radius-md"]).toBe(DEFAULT_THEME.tokens["radius-md"])
  })

  it("applies resolved tokens directly to document CSS variables", () => {
    applyThemeConfigToDocument({
      theme: "custom",
      mode: "dark",
      tokens: {
        accent: "#ff00aa",
        "radius-md": "0.625rem",
      },
    })

    expect(document.documentElement.getAttribute("data-theme")).toBe("custom")
    expect(document.documentElement.style.getPropertyValue("--p-accent")).toBe("#ff00aa")
    expect(document.documentElement.style.getPropertyValue("--radius-md")).toBe("0.625rem")
    expect(document.documentElement.style.getPropertyValue("--p-surface")).toBe(DEFAULT_THEME.tokens.surface)
  })
})
