import type { ApolloClient, NormalizedCacheObject } from "@apollo/client"
import { INITIAL_AGENTS } from "@/lib/data/mock"
import { GET_AGENTS } from "@/lib/graphql/queries/agents"

/* ================================================================== */
/*  MOCK DATA SEEDER                                                   */
/*                                                                     */
/*  Seeds Apollo cache with fake data for development.                 */
/*  This replaces zustand's INITIAL_AGENTS for the agents query.       */
/*  Delete this file when connecting to real backend.                  */
/* ================================================================== */

export function seedMockData(client: ApolloClient<NormalizedCacheObject>) {
  client.writeQuery({
    query: GET_AGENTS,
    data: {
      agents: INITIAL_AGENTS.map((a) => ({
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
}
