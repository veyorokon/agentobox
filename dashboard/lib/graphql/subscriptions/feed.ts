import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED SUBSCRIPTIONS                                                  */
/*                                                                      */
/*  Not active during mock phase — defined here to document the        */
/*  real-time strategy for right column migration (Part 2b).           */
/* ================================================================== */

export const ON_FEED_ITEM_ADDED = gql`
  subscription OnFeedItemAdded($projectId: ID!) {
    feedItemAdded(projectId: $projectId) {
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
