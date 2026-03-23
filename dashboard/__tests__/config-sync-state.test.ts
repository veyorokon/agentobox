/**
 * Config sync state machine tests.
 *
 * Pure logic tests for deriveConfigSyncStatus + rendered tests for
 * CardActionStrip banner states. Prevents regression of #144/#147
 * (contradictory toast + banner after save).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import React from "react"

import {
  extractConfigFields,
  deriveConfigSyncStatus,
  type ConfigFields,
} from "@/components/agent/settings-panel"
import type { ConfigSyncState } from "@/lib/types"

/* ================================================================== */
/*  PURE LOGIC: deriveConfigSyncStatus                                 */
/* ================================================================== */

const base: ConfigFields = {
  model: "claude-sonnet-4-6",
  instructions: "do the thing",
  tags: ["alpha"],
  mcpNames: ["playwright"],
}

function withOverrides(overrides: Partial<ConfigFields>): ConfigFields {
  return { ...base, ...overrides }
}

describe("deriveConfigSyncStatus", () => {
  it("returns in-sync when local matches server and current is in-sync", () => {
    expect(deriveConfigSyncStatus(base, null, base, "in-sync")).toBe("in-sync")
  })

  it("returns unsaved when local differs from server and current is in-sync", () => {
    const local = withOverrides({ model: "claude-opus-4-6" })
    expect(deriveConfigSyncStatus(local, null, base, "in-sync")).toBe("unsaved")
  })

  it("stays saving when server has not updated to lastSubmittedConfig yet", () => {
    const local = withOverrides({ model: "claude-opus-4-6" })
    const submitted = withOverrides({ model: "claude-opus-4-6" })
    // Server still has old value — refetch has not landed
    expect(deriveConfigSyncStatus(local, submitted, base, "saving")).toBe("saving")
  })

  it("returns in-sync when server matches lastSubmittedConfig and local matches server", () => {
    const submitted = withOverrides({ model: "claude-opus-4-6" })
    const server = withOverrides({ model: "claude-opus-4-6" })
    const local = withOverrides({ model: "claude-opus-4-6" })
    expect(deriveConfigSyncStatus(local, submitted, server, "saving")).toBe("in-sync")
  })

  it("returns unsaved when server matches lastSubmittedConfig but local differs (user edited during save)", () => {
    const submitted = withOverrides({ model: "claude-opus-4-6" })
    const server = withOverrides({ model: "claude-opus-4-6" })
    // User changed model again while save was in flight
    const local = withOverrides({ model: "claude-haiku-4-5" })
    expect(deriveConfigSyncStatus(local, submitted, server, "saving")).toBe("unsaved")
  })

  it("returns in-sync when local matches server and current is save-error (user reverted)", () => {
    expect(deriveConfigSyncStatus(base, null, base, "save-error")).toBe("in-sync")
  })

  it("returns unsaved when local differs from server and current is save-error", () => {
    const local = withOverrides({ instructions: "new instructions" })
    expect(deriveConfigSyncStatus(local, null, base, "save-error")).toBe("unsaved")
  })

  it("detects tag differences", () => {
    const local = withOverrides({ tags: ["alpha", "beta"] })
    expect(deriveConfigSyncStatus(local, null, base, "in-sync")).toBe("unsaved")
  })

  it("detects mcpNames differences", () => {
    const local = withOverrides({ mcpNames: ["playwright", "github"] })
    expect(deriveConfigSyncStatus(local, null, base, "in-sync")).toBe("unsaved")
  })
})

/* ================================================================== */
/*  PURE LOGIC: extractConfigFields                                    */
/* ================================================================== */

describe("extractConfigFields", () => {
  it("extracts from agent-shaped object (mcpServers)", () => {
    const agent = { model: "m", instructions: "i", tags: ["t"], mcpServers: ["s"] }
    const result = extractConfigFields(agent)
    expect(result).toEqual({ model: "m", instructions: "i", tags: ["t"], mcpNames: ["s"] })
  })

  it("extracts from local-shaped object (mcpNames)", () => {
    const local = { model: "m", instructions: "i", tags: ["t"], mcpNames: ["s"] }
    const result = extractConfigFields(local)
    expect(result).toEqual({ model: "m", instructions: "i", tags: ["t"], mcpNames: ["s"] })
  })

  it("defaults mcpNames to empty array when neither field exists", () => {
    const minimal = { model: "m", instructions: "i", tags: [] }
    const result = extractConfigFields(minimal)
    expect(result.mcpNames).toEqual([])
  })
})

/* ================================================================== */
/*  RENDERED: CardActionStrip banner states                            */
/* ================================================================== */

// Inline import to avoid heavy dep tree — just test the strip component
import { CardActionStrip } from "@/components/agent/card-action-strip"
import type { CardActionItem } from "@/lib/types"

const noop = () => {}

afterEach(cleanup)

function renderStrip(syncState: ConfigSyncState, onSave = noop) {
  const items: CardActionItem[] = [{ kind: "config-sync", syncState }]
  return render(
    React.createElement(CardActionStrip, {
      items,
      onResolvePermission: noop,
      onResolvePlan: noop,
      onSave,
      onDismissSkill: noop,
      onViewSkill: noop,
    }),
  )
}

describe("CardActionStrip config-sync rendering", () => {
  it("renders 'Unsaved changes' with 'Save changes' button for unsaved state", () => {
    renderStrip({ status: "unsaved" })
    expect(screen.getByText("Unsaved changes")).toBeTruthy()
    expect(screen.getByText("Save changes")).toBeTruthy()
  })

  it("renders 'Saving...' with no save/retry button for saving state", () => {
    renderStrip({ status: "saving" })
    expect(screen.getByText("Saving...")).toBeTruthy()
    expect(screen.queryByText("Save changes")).toBeNull()
    expect(screen.queryByText("Retry")).toBeNull()
  })

  it("renders error message with 'Retry' button for save-error state", () => {
    renderStrip({ status: "save-error", message: "Network error" })
    expect(screen.getByText("Network error")).toBeTruthy()
    expect(screen.getByText("Retry")).toBeTruthy()
  })

  it("calls onSave when 'Save changes' button is clicked", () => {
    const onSave = vi.fn()
    renderStrip({ status: "unsaved" }, onSave)
    screen.getByText("Save changes").click()
    expect(onSave).toHaveBeenCalledOnce()
  })

  it("calls onSave when 'Retry' button is clicked", () => {
    const onSave = vi.fn()
    renderStrip({ status: "save-error", message: "fail" }, onSave)
    screen.getByText("Retry").click()
    expect(onSave).toHaveBeenCalledOnce()
  })
})
