import type { ApolloClient, NormalizedCacheObject } from "@apollo/client"
import { MOCK_AGENTS, TEAM_FEED } from "@/lib/data/mock"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"
import { GET_FEED } from "@/lib/graphql/queries/feed"
import type { TeamFeedItem } from "@/lib/types"

/* ================================================================== */
/*  DEV DATA SEEDER                                                    */
/*                                                                     */
/*  Seeds Apollo cache with fixture data for development.              */
/*  This replaces zustand for agents + feed queries.                   */
/*  Delete this file when connecting to real backend.                  */
/* ================================================================== */

/**
 * Normalize a TeamFeedItem into the flat union shape GET_FEED expects.
 * Every field from the query must be present — missing fields become null.
 */
function normalizeFeedItem(item: TeamFeedItem) {
  return {
    __typename: "FeedItem" as const,
    id: item.id,
    type: item.type,
    // Flat union: every field present, null if not applicable
    agent: "agent" in item ? item.agent : null,
    text: "text" in item ? item.text : null,
    command: item.type === "permission" ? item.command : null,
    risk: item.type === "permission" ? (item.risk ?? null) : null,
    permStatus: item.type === "permission" ? item.permStatus : null,
    title: item.type === "plan" ? item.title : null,
    plan: item.type === "plan" ? item.plan : null,
    planStatus: item.type === "plan" ? item.planStatus : null,
    summary: item.type === "summary" ? item.summary : null,
    cost: item.type === "summary" ? item.cost : null,
    turns: item.type === "summary" ? item.turns : null,
    duration: item.type === "summary" ? item.duration : null,
    from: "from" in item ? item.from : null,
    to: "to" in item ? item.to : null,
    target: "target" in item ? (item.target ?? null) : null,
    question: item.type === "question" ? item.question : null,
    options: item.type === "question" ? item.options : null,
    questions: item.type === "multi-question"
      ? item.questions.map(q => ({ __typename: "FeedQuestion" as const, text: q.text, options: q.options }))
      : null,
    isError: item.type === "summary" ? (item.isError ?? null) : null,
  }
}

export function seedDevData(client: ApolloClient<NormalizedCacheObject>) {
  client.writeQuery({
    query: GET_AGENTS,
    data: {
      agents: MOCK_AGENTS.map((a) => ({
        __typename: "Agent",
        id: a.id,
        name: a.name,
        lifecycleStatus: a.lifecycleStatus,
        attentionLevel: a.attentionLevel,
        mode: a.mode,
        task: a.task,
        cost: a.cost,
        duration: a.duration,
        model: a.model,
        turns: a.turns,
        phase: a.phase ?? null,
        liveAction: a.liveAction ?? null,
        lastOutput: a.lastOutput,
        tags: a.tags,
        instructions: a.instructions,
        mcpServers: a.mcpServers,
        runtime: a.runtime,
        workspacePath: a.workspacePath,
        todoProgress: a.todoProgress
          ? { __typename: "TodoProgress", done: a.todoProgress.done, total: a.todoProgress.total }
          : null,
      })),
    },
  })

  client.writeQuery({
    query: GET_FEED,
    data: {
      feed: TEAM_FEED.map(normalizeFeedItem),
    },
  })
}
