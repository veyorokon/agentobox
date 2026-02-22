import { gql } from "@apollo/client"
import { AGENT_FIELDS } from "./fragments"

export const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      user {
        id
        username
        email
      }
      token
    }
  }
`

export const CREATE_PROJECT_MUTATION = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      description
      settings
      createdAt
      archivedAt
    }
  }
`

export const CREATE_AGENT_MUTATION = gql`
  ${AGENT_FIELDS}
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      ...AgentFields
    }
  }
`

export const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input)
  }
`

export const BROADCAST_MESSAGE_MUTATION = gql`
  mutation BroadcastMessage($input: BroadcastMessageInput!) {
    broadcastMessage(input: $input)
  }
`

export const KILL_AGENT_MUTATION = gql`
  mutation KillAgent($agentId: ID!) {
    killAgent(agentId: $agentId)
  }
`

export const RESTART_AGENT_MUTATION = gql`
  ${AGENT_FIELDS}
  mutation RestartAgent($agentId: ID!) {
    hardRestartAgent(agentId: $agentId) {
      ...AgentFields
    }
  }
`

export const REMOVE_AGENT_MUTATION = gql`
  mutation RemoveAgent($agentId: ID!) {
    removeAgent(agentId: $agentId)
  }
`

export const SET_AGENT_MODE_MUTATION = gql`
  ${AGENT_FIELDS}
  mutation SetAgentMode($agentId: ID!, $mode: String!) {
    setAgentMode(agentId: $agentId, mode: $mode) {
      ...AgentFields
    }
  }
`

export const CLEAR_AGENT_SESSION_MUTATION = gql`
  mutation ClearAgentSession($agentId: ID!) {
    clearAgentSession(agentId: $agentId)
  }
`
