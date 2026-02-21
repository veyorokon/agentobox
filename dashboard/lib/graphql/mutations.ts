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
      createdAt
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

export const ANSWER_QUESTION_MUTATION = gql`
  mutation AnswerQuestion($input: AnswerQuestionInput!) {
    answerQuestion(input: $input)
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
    restartAgent(agentId: $agentId) {
      ...AgentFields
    }
  }
`

export const INTERRUPT_AGENT_MUTATION = gql`
  mutation InterruptAgent($agentId: ID!) {
    interruptAgent(agentId: $agentId)
  }
`
