import { gql } from 'urql';

export const ME_QUERY = gql`
  query Me {
    me {
      id
      username
      email
    }
  }
`;

export const PROJECTS_QUERY = gql`
  query Projects {
    projects {
      id
      name
      createdAt
    }
  }
`;

export const AGENTS_QUERY = gql`
  query Agents($projectId: ID!) {
    agents(projectId: $projectId) {
      id
      name
      role
      runtime
      sandboxId
      vncUrl
      status
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
  }
`;

export const PROJECT_SECRETS_QUERY = gql`
  query ProjectSecrets($projectId: ID!) {
    projectSecrets(projectId: $projectId) {
      id
      key
      projectId
      scopedAgentIds
      createdAt
      updatedAt
    }
  }
`;

export const PROJECT_FEED_QUERY = gql`
  query ProjectFeed($projectId: ID!, $limit: Int, $before: String) {
    projectFeed(projectId: $projectId, limit: $limit, before: $before) {
      items {
        id
        kind
        agentId
        agentName
        timestamp
        text
        imageUrls
        targetName
        targetAgentIds
        tools {
          name
          input
          result
          isError
        }
        fromStatus
        toStatus
        taskSummary
        errorText
        cumulativeCostUsd
        questions {
          question
          header
          options {
            label
            description
          }
          multiSelect
        }
        answers {
          selectedIndices
          otherText
        }
        toolUseId
        memoryContent
        planStatus
        planSummary
        planSteps
        taskDividerSubject
        taskDividerId
        taskDividerActiveForm
        senderName
      }
      hasMore
      endCursor
    }
  }
`;

export const AGENT_OPTIONS_QUERY = gql`
  query AgentOptions {
    availableModels {
      value
      label
    }
    mcpRegistry {
      name
      compat
    }
  }
`;

export const AGENT_MESSAGES_QUERY = gql`
  query AgentMessages($agentId: ID!) {
    agent(agentId: $agentId) {
      id
      streamMessages {
        id
        messageId
        agentId
        sessionId
        role
        model
        parts
        usage
        parentToolUseId
        stopReason
        turnNumber
        createdAt
      }
      sessionResult {
        id
        sessionId
        isError
        totalCostUsd
        durationMs
        durationApiMs
        numTurns
        modelUsage
        permissionDenials
      }
    }
  }
`;
