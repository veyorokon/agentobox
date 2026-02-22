import { gql } from "@apollo/client"
import {
  AGENT_FIELDS,
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
  query Projects($includeArchived: Boolean) {
    projects(includeArchived: $includeArchived) {
      id
      name
      description
      settings
      createdAt
      archivedAt
    }
  }
`

export const PROJECT_QUERY = gql`
  query Project($id: ID!) {
    project(id: $id) {
      id
      name
      description
      settings
      createdAt
      archivedAt
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

export const AGENT_FEED_QUERY = gql`
  ${TIMELINE_FIELDS}
  query AgentFeed($agentId: ID!, $first: Int, $after: String) {
    agentFeed(agentId: $agentId, first: $first, after: $after) {
      edges {
        cursor
        node {
          ...TimelineFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

export const PROJECT_FEED_QUERY = gql`
  ${TIMELINE_FIELDS}
  query ProjectFeed($projectId: ID!, $first: Int, $after: String) {
    projectFeed(projectId: $projectId, first: $first, after: $after) {
      edges {
        cursor
        node {
          ...TimelineFields
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`
