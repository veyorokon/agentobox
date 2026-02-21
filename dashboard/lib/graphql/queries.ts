import { gql } from "@apollo/client"
import {
  AGENT_FIELDS,
  EVENT_FIELDS,
  FEED_ITEM_FIELDS,
  TIMELINE_FIELDS,
} from "./fragments"

export const ME_QUERY = gql`
  query Me {
    me {
      id
      username
      email
    }
  }
`

export const PROJECTS_QUERY = gql`
  query Projects {
    projects {
      id
      name
      createdAt
    }
  }
`

export const PROJECT_QUERY = gql`
  query Project($id: ID!) {
    project(id: $id) {
      id
      name
      createdAt
    }
  }
`

export const AGENTS_QUERY = gql`
  ${AGENT_FIELDS}
  query Agents($projectId: ID!) {
    agents(projectId: $projectId) {
      ...AgentFields
    }
  }
`

export const AGENT_QUERY = gql`
  ${AGENT_FIELDS}
  query Agent($agentId: ID!) {
    agent(agentId: $agentId) {
      ...AgentFields
    }
  }
`

export const AGENT_FEED_QUERY = gql`
  ${FEED_ITEM_FIELDS}
  query AgentFeed($agentId: ID!, $limit: Int, $offset: Int) {
    agentFeed(agentId: $agentId, limit: $limit, offset: $offset) {
      ...FeedItemFields
    }
  }
`

export const PROJECT_FEED_QUERY = gql`
  ${FEED_ITEM_FIELDS}
  query ProjectFeed($projectId: ID!, $limit: Int, $offset: Int) {
    projectFeed(projectId: $projectId, limit: $limit, offset: $offset) {
      ...FeedItemFields
    }
  }
`

export const EVENTS_QUERY = gql`
  ${EVENT_FIELDS}
  query Events($projectId: ID!, $limit: Int) {
    events(projectId: $projectId, limit: $limit) {
      ...EventFields
    }
  }
`

export const TIMELINE_QUERY = gql`
  ${TIMELINE_FIELDS}
  query Timeline($projectId: ID!, $limit: Int, $offset: Int) {
    timeline(projectId: $projectId, limit: $limit, offset: $offset) {
      ...TimelineFields
    }
  }
`

export const SECRET_GROUPS_QUERY = gql`
  query SecretGroups($projectId: ID!) {
    secretGroups(projectId: $projectId) {
      id
      name
      createdAt
      updatedAt
      projectId
      keys
    }
  }
`
