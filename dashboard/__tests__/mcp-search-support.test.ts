/**
 * @vitest-environment jsdom
 */

import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { AgentSettingsPanel } from "@/components/agent/settings-panel"
import type { Agent } from "@/lib/types"

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj_1" }),
}))

vi.mock("@/lib/graphql/hooks/use-agents", () => ({
  useAgents: () => ({ data: { agents: [] } }),
  useRemoveAgent: () => vi.fn(),
  useUpdateAgentInstructions: () => vi.fn(),
  useUpdateAgentConfig: () => vi.fn(),
}))

vi.mock("@/lib/graphql/hooks/use-models", () => ({
  useAvailableModels: () => ({ models: [{ provider: "anthropic", value: "claude", label: "Claude" }] }),
  useProviderStatus: () => ({ providers: [] }),
}))

vi.mock("@/lib/graphql/hooks/use-skills", () => ({
  useSkills: () => ({ data: { skills: [] } }),
}))

vi.mock("@/lib/graphql/hooks/use-mcp-search", () => ({
  useMcpSearch: () => ({
    query: "remote",
    setQuery: vi.fn(),
    loading: false,
    results: [
      {
        name: "io.github.example/remote-only",
        description: "Remote only MCP",
        version: "1.0.0",
        websiteUrl: "https://example.com",
        hasRemote: true,
        attachable: false,
        unsupportedReason: "Remote MCPs are discoverable, but this runtime only supports direct stdio launch right now.",
        packages: [],
      },
    ],
  }),
}))

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
})

const agent: Agent = {
  id: "agent_1",
  name: "Agent One",
  lifecycleStatus: "idle",
  previewState: "ready",
  previewRuntimeId: "sandbox_1",
  attentionLevel: "none",
  relayConnected: true,
  task: "",
  cost: 0,
  duration: "0s",
  model: "claude",
  turns: 0,
  lastOutput: "",
  phase: "",
  liveAction: "",
  errorMessage: "",
  taskProgress: undefined,
  triggers: [],
  computeSeconds: 0,
  instructions: "",
  mcpServers: [],
  mcpConfig: {},
  runtime: "docker",
  workspacePath: "/workspace",
  tags: [],
  mode: "auto",
  tasks: [],
}

describe("MCP registry support surface", () => {
  it("shows unsupported registry results as disabled instead of addable", () => {
    render(React.createElement(AgentSettingsPanel, { agent }))

    fireEvent.click(screen.getByRole("button", { name: /add from registry/i }))

    const unsupported = screen.getByRole("button", { name: /io.github.example\/remote-only/i })
    expect((unsupported as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/only supports direct stdio launch/i)).toBeTruthy()
    expect(screen.getByText("unsupported")).toBeTruthy()
  })
})
