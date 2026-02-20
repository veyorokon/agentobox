import { gql } from 'urql';
import { AGENT_FIELDS_FRAGMENT } from './fragments';

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
`;

export const REGISTER_MUTATION = gql`
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      user {
        id
        username
        email
      }
      token
    }
  }
`;

export const CREATE_PROJECT_MUTATION = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id
      name
      createdAt
    }
  }
`;

export const CREATE_AGENT_MUTATION = gql`
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      ...AgentFields
    }
  }
  ${AGENT_FIELDS_FRAGMENT}
`;

export const SET_SECRET_MUTATION = gql`
  mutation SetSecret($input: SetSecretInput!) {
    setSecret(input: $input) {
      id
      key
      projectId
      scopedAgentIds
      createdAt
      updatedAt
    }
  }
`;

export const DELETE_SECRET_MUTATION = gql`
  mutation DeleteSecret($projectId: ID!, $key: String!) {
    deleteSecret(projectId: $projectId, key: $key)
  }
`;

export const SCOPE_SECRET_MUTATION = gql`
  mutation ScopeSecret($input: ScopeSecretInput!) {
    scopeSecret(input: $input) {
      id
      key
      scopedAgentIds
    }
  }
`;

export const KILL_AGENT_MUTATION = gql`
  mutation KillAgent($agentId: ID!) {
    killAgent(agentId: $agentId)
  }
`;

export const REMOVE_AGENT_MUTATION = gql`
  mutation RemoveAgent($agentId: ID!) {
    removeAgent(agentId: $agentId)
  }
`;

export const RESTART_AGENT_MUTATION = gql`
  mutation RestartAgent($agentId: ID!) {
    restartAgent(agentId: $agentId)
  }
`;

export const HARD_RESTART_AGENT_MUTATION = gql`
  mutation HardRestartAgent($agentId: ID!) {
    hardRestartAgent(agentId: $agentId) {
      id
      name
      status
    }
  }
`;

export const CLEAR_AGENT_SESSION_MUTATION = gql`
  mutation ClearAgentSession($agentId: ID!) {
    clearAgentSession(agentId: $agentId)
  }
`;

export const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input)
  }
`;

export const INTERRUPT_AGENT_MUTATION = gql`
  mutation InterruptAgent($agentId: ID!) {
    interruptAgent(agentId: $agentId)
  }
`;

export const BROADCAST_MESSAGE_MUTATION = gql`
  mutation BroadcastMessage($input: BroadcastMessageInput!) {
    broadcastMessage(input: $input)
  }
`;

export const ANSWER_QUESTION_MUTATION = gql`
  mutation AnswerQuestion($input: AnswerQuestionInput!) {
    answerQuestion(input: $input)
  }
`;

export const UPDATE_AGENT_INSTRUCTIONS_MUTATION = gql`
  mutation UpdateAgentInstructions($input: UpdateAgentInstructionsInput!) {
    updateAgentInstructions(input: $input) {
      id
      instructions
    }
  }
`;

export const DELETE_PROJECT_MUTATION = gql`
  mutation DeleteProject($id: ID!) {
    deleteProject(id: $id)
  }
`;

export const UPDATE_PROJECT_MUTATION = gql`
  mutation UpdateProject($id: ID!, $name: String!) {
    updateProject(id: $id, name: $name) {
      id
      name
    }
  }
`;

export const STOP_ALL_AGENTS_MUTATION = gql`
  mutation StopAllAgents($projectId: ID!) {
    stopAllAgents(projectId: $projectId)
  }
`;

export const UPDATE_AGENT_CONFIG_MUTATION = gql`
  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {
    updateAgentConfig(input: $input) {
      id
      name
      model
      role
      mcpServers
      status
    }
  }
`;

export const SET_PROJECT_THEME_MUTATION = gql`
  mutation SetProjectTheme($input: SetProjectThemeInput!) {
    setProjectTheme(input: $input)
  }
`;
