import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED QUERIES                                                        */
/* ================================================================== */

export const GET_AGENT_FEED = gql`
  query GetAgentFeed($agentId: ID!, $first: Int, $after: String) {
    agentFeed(agentId: $agentId, first: $first, after: $after) {
      id
      entryType
      agentId
      agentName
      summary
      data
      createdAt
    }
  }
`

export const GET_FEED = gql`
  query GetFeed($projectId: ID!) {
    feed: teamFeed(projectId: $projectId) {
      id
      type
      agent
      agentId
      text
      command
      risk
      permStatus
      title
      plan
      planStatus
      summary
      cost
      turns
      duration
      from
      to
      target
      question
      options
      questions {
        text
        options
      }
      isError
    }
  }
`
