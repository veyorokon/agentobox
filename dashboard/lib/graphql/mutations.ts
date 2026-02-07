import { gql } from 'urql';

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
      defaultRuntime
      createdAt
    }
  }
`;

export const CREATE_AGENT_MUTATION = gql`
  mutation CreateAgent($input: CreateAgentInput!) {
    createAgent(input: $input) {
      id
      name
      runtime
      sandboxId
      vncUrl
      status
      confidence
      sentiment
      summary
      reasoning
      output
      createdAt
      completedAt
      goal {
        id
        text
        contextPath
        plan
        status
        createdAt
        satisfiedAt
      }
    }
  }
`;

export const KILL_AGENT_MUTATION = gql`
  mutation KillAgent($agentId: ID!) {
    killAgent(agentId: $agentId)
  }
`;

export const SEND_MESSAGE_MUTATION = gql`
  mutation SendMessage($input: SendMessageInput!) {
    sendMessage(input: $input)
  }
`;
// SendMessageInput: { agentId: ID!, message: String! }

