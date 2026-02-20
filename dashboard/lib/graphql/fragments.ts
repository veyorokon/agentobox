import { gql } from 'urql';

export const AGENT_FIELDS_FRAGMENT = gql`
  fragment AgentFields on AgentType {
    id
    name
    role
    runtime
    sandboxId
    vncUrl
    status
    phase
    teamName
    sessionId
    model
    cwd
    permissionMode
    mcpServers
    workspacePath
    instructions
    sessionCostUsd
    capabilities
    createdAt
  }
`;
