import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED QUERIES                                                        */
/*                                                                      */
/*  Defined for Part 2b (right column migration). Not wired yet.       */
/* ================================================================== */

export const GET_FEED = gql`
  query GetFeed {
    feed {
      id
      type
      agent
      text
      command
      risk
      permStatus
      title
      plan
      planStatus
      summary
      cost
      turns
      duration
      from
      to
      target
      question
      options
      questions {
        text
        options
      }
      isError
    }
  }
`
