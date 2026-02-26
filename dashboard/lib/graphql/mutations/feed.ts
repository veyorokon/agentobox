import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED MUTATIONS                                                      */
/*                                                                      */
/*  Defined for Part 2b (right column migration). Not wired yet.       */
/* ================================================================== */

export const SEND_MESSAGE = gql`
  mutation SendMessage($text: String!, $recipients: [RecipientInput!]!) {
    sendMessage(text: $text, recipients: $recipients) {
      id
      type
      text
      target
    }
  }
`
