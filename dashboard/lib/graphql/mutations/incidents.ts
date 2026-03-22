import { gql } from "@apollo/client"

export const CAPTURE_INCIDENT = gql`
  mutation CaptureIncident($input: CaptureIncidentInput!) {
    captureIncident(input: $input) {
      incidentId
      agentId
      projectId
      createdAt
    }
  }
`
