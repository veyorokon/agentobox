import { gql } from "@apollo/client"

export const CREATE_VNC_TOKEN = gql`
  mutation CreateVncToken($agentId: ID!) {
    createVncToken(agentId: $agentId) {
      token
      expiresAt
    }
  }
`
