import { gql } from "@apollo/client"

/* ================================================================== */
/*  FEED SUBSCRIPTIONS                                                  */
/*                                                                      */
/*  Not active during dev phase — defined here to document the         */
/*  real-time strategy for right column migration (Part 2b).           */
/* ================================================================== */

export const ON_FEED_ITEM_CHANGED = gql`
  subscription OnFeedItemChanged($projectId: ID!) {
    feedItemChanged(projectId: $projectId) {
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
