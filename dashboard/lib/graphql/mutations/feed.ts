import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED MUTATIONS                                                      */
/*                                                                      */
/*  Defined for Part 2b (right column migration). Not wired yet.       */
/* ================================================================== */

export const SEND_MESSAGE = gql`
  mutation SendMessage($projectId: ID!, $text: String!, $recipients: [RecipientInput!]!) {
    sendMessage(projectId: $projectId, text: $text, recipients: $recipients)
  }
`
