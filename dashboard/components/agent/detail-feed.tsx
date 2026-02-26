"use client"

import { AssistantMessage } from "@/components/feed/assistant-message"
import { SingleToolRow, MultiToolGroup } from "@/components/feed/tool-row"
import { ResultPill } from "@/components/feed/result-pill"
import { ErrorBubble } from "@/components/feed/error-bubble"
import { FAKE_MARKDOWN } from "@/lib/data/mock"
import type { FakeAgent } from "@/lib/types"

/* ================================================================== */
/*  AGENT DETAIL FEED                                                  */
/* ================================================================== */

export interface AgentDetailFeedProps {
  agent: FakeAgent
}

/**
 * Agent detail mini-feed — shows VERBOSE output for a single agent.
 * This is the drill-in view. Content comes from TimelineEntry.content
 * (full content blocks), NOT from the summary field.
 *
 * SOURCE: TimelineEntry.content — tool_use blocks, assistant text,
 *   thinking blocks, tool_result blocks. Everything the team feed hides.
 */
export function AgentDetailFeed({ agent }: AgentDetailFeedProps) {
  const isError = agent.lifecycleStatus === "error"

  return (
    <div className="border-t border-border-subtle flex flex-col">

      {/* Historical content only — scrollable mini-feed */}
      <div className="flex-1 min-h-0 max-h-[320px] overflow-y-auto px-3 py-2 space-y-2">
        {agent.name === "backend" ? (
          <>
            {/* Tool calls (source: tool_use content blocks) */}
            <SingleToolRow toolName="Read" summary="src/auth.ts" />
            <SingleToolRow toolName="Read" summary="src/middleware/auth.ts" />

            {/* Assistant message (source: text content blocks) */}
            <AssistantMessage
              agent={agent.name}
              content={FAKE_MARKDOWN}
              showAvatar={false}
            />

            {/* More tool calls */}
            <MultiToolGroup
              tools={[
                { name: "Edit", summary: "src/auth.ts — fix validateToken()" },
                { name: "Edit", summary: "src/middleware/auth.ts — reorder handlers" },
                { name: "Bash", summary: "npm run lint" },
              ]}
            />

            <AssistantMessage
              agent={agent.name}
              content="Applied the fix and ran the linter. All clean."
              showAvatar={false}
            />

            {/* Result pill (source: result message) */}
            <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
          </>
        ) : agent.name === "qa" ? (
          <>
            <SingleToolRow toolName="Bash" summary="npm test -- --filter auth" />
            {isError ? (
              <ErrorBubble
                agent={agent.name}
                text={"FAIL src/auth.test.ts\n\nExpected: 200\nReceived: 401\n\nThe refresh endpoint middleware ordering is wrong."}
              />
            ) : (
              <>
                <AssistantMessage
                  agent={agent.name}
                  content="Running the full auth test suite. 47 tests found."
                  showAvatar={false}
                />
                <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
              </>
            )}
          </>
        ) : agent.name === "frontend" ? (
          <>
            <SingleToolRow toolName="Read" summary="src/components/Button.tsx" />
            <SingleToolRow toolName="Read" summary="src/styles/tokens.css" />
            <AssistantMessage
              agent={agent.name}
              content="Scanning Tailwind classes in Button, Card, and Input components..."
              showAvatar={false}
            />
          </>
        ) : agent.name === "docs" ? (
          <>
            <SingleToolRow toolName="Read" summary="docs/api-reference.md" />
            <MultiToolGroup
              tools={[
                { name: "Edit", summary: "docs/api-reference.md — add rotation docs" },
                { name: "Edit", summary: "docs/auth-flow.md — update diagram" },
              ]}
            />
            <AssistantMessage
              agent={agent.name}
              content="Updated API reference with refresh token rotation documentation and migration notes."
              showAvatar={false}
            />
            <ResultPill cost={agent.cost} duration={agent.duration} turns={agent.turns} model={agent.model} />
          </>
        ) : (
          /* Generic fallback for devops, infra, etc. */
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-muted/50 font-mono">
              {agent.lifecycleStatus === "deploying" ? "Initializing workspace..." : "No activity yet"}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}
