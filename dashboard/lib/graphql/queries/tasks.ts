import { gql } from "@apollo/client"

export const GET_AGENT_TASKS = gql`
  query GetAgentTasks($agentId: ID!) {
    agent(agentId: $agentId) {
      id
      tasks {
        taskId
        subject
        description
        status
        owner
        activeForm
        blockedBy
        createdAt
        updatedAt
      }
    }
  }
`
