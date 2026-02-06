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
      defaultRuntime
      createdAt
    }
  }
`;

export const AGENTS_QUERY = gql`
  query Agents($projectId: ID!) {
    agents(projectId: $projectId) {
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

export const GOALS_QUERY = gql`
  query Goals($projectId: ID!) {
    goals(projectId: $projectId) {
      id
      text
      contextPath
      plan
      status
      createdAt
      satisfiedAt
    }
  }
`;
