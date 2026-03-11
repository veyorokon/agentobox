# Agentobox Dashboard Reference

> Auto-generated from codebase. Do not edit — regenerate with `node dashboard/scripts/generate-reference.mjs`.

## Modules

### dashboard/app/p/[projectId]/loading.tsx

Instant loading UI shown during navigation to a project page.

Next.js app router renders this immediately while the page component
and its data load. Skeleton matches the project dashboard layout so
the transition feels seamless rather than jarring.

### dashboard/lib/skill-notifications.ts

Skill notification system for agent cards
Tracks which skills have been dismissed per agent

### dashboard/lib/toast.ts

Simple toast notification system
Uses a singleton pattern to manage toast state

## Test Principles

### dashboard/__tests__/architecture.test.ts

Frontend architecture enforcement tests.

Static analysis — reads source files and checks structural patterns.
No React rendering, no DOM, no browser. Just file scanning with regex.

Principles enforced:
 1. Zustand stores hold only client UI state — never server data
 2. Apollo hooks follow naming conventions and use the unified logger
 3. Components subscribe directly to stores/hooks — no prop drilling
 4. Bridge hooks are the only place cross-entity cache mutations happen
 5. All zustand stores use the logging middleware

**Zustand Store Principles**
- stores never import from @apollo/client
- stores never import server data types (Agent, TeamFeedItem, Skill)
- all stores use the zustandLog middleware
- store exports follow use<Name>Store naming convention

**Apollo Hook Principles**
- all hook files use the unified logger
- query hooks follow use<Domain> naming convention
- bridge hooks follow useResolve<Action> naming convention
- hook files never import from zustand stores

**Component Architecture**
- no component imports writeQuery from Apollo
- subscriptions are only called from the page component
- page component is a layout shell (no direct cache.modify)
- components never call cache.modify directly (only hooks can)
- zustand store hooks always use selectors (no bare useXStore() calls)

**Logging Discipline**
- zustand log-middleware uses createLogger
- every apollo hooks file initializes a logger

**Naming Conventions**
- hook files are named use-<domain>.ts
- store files dont have use- prefix (files are <domain>.ts, exports are use<Domain>Store)

### dashboard/__tests__/e2e-smoke.test.ts

E2E smoke / contract tests.

Lightweight HTTP-level tests that verify the GraphQL endpoint returns
the expected response shapes. Uses raw fetch() (no Apollo) to match
how the login page works.

These tests require the backend to be running at localhost:8000.
Skip with: SKIP_E2E=1 npx vitest run

**login mutation**
- returns token and user shape on valid credentials
- returns error on invalid credentials

**agents query**
- returns an array with expected field shapes when authenticated
- rejects unauthenticated requests

**feed query**
- returns an array with expected field shapes when authenticated

### dashboard/__tests__/hooks.test.ts

Apollo hook unit tests.

Tests the data layer hooks with MockedProvider — verifies that queries
parse correctly, mutations fire, and bridge hooks update the cache
across entity boundaries (FeedItem → Agent).

@vitest-environment jsdom

**useAgents**
- returns loading=true initially, then agents data
- returns multiple agents when backend sends them
- reports GraphQL errors

**useFeed**
- returns feed items with correct types
- returns permission item fields correctly
- returns plan item fields correctly

**useResolvePermission**
- optimistically updates feed item permStatus and derives agent attention
- passes alwaysAllow=true when requested

**useResolvePlan**
- optimistically updates feed item planStatus and derives agent attention
- preserves higher attention when other pending items remain

**optimistic update contracts: lifecycle hooks**
- useRestartAgent does NOT change lifecycleStatus (soft restart = signal only)
- useHardRestartAgent DOES set lifecycleStatus to deploying (full redeploy)
- useRestartAgent preserves relayConnected (soft restart does not disconnect)

### dashboard/__tests__/state-consistency.test.ts

State consistency tests.

Verifies that when shared state (Apollo cache) is updated, ALL components
that consume that state reflect the change. Catches the bug class where
the team feed panel shows data but the agent card silently drops it.

Pattern:
  1. Seed Apollo cache with agent + feed items (simulating WS snapshot)
  2. Render TeamFeed → assert feed item text appears in the DOM
  3. Render AgentCardRow (expanded) → assert same text appears in card DOM
  4. Tests that FAIL prove the desync gap

@vitest-environment jsdom

**state consistency: feed items visible across UI components**

**permission items**
- renders in TeamFeed
- renders in AgentCardRow when expanded

**plan items**
- renders in TeamFeed
- renders in AgentCardRow when expanded

**summary items**
- renders in TeamFeed
- does NOT render in AgentCardRow — summaries live in the feed tab only

**error items**
- renders in TeamFeed
- does NOT render in AgentCardRow — errors live in the feed tab only

## Exception Annotations

| File | Line | Annotation |
|------|------|------------|
| vnc-thumbnail.tsx | 16 | react-vnc throws on unmount when RFB is already disconnected — harmless |
| theme-picker.tsx | 50 | theme sync to backend is best-effort — local switch already applied |
| theme.ts | 36 | corrupt localStorage — fall through to default |
| theme.ts | 46 | localStorage full or unavailable — non-critical |
