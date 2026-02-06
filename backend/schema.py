import strawberry

from accounts.graphql.mutations import AccountMutation
from accounts.graphql.queries import AccountQuery
from agents.graphql.mutations import AgentMutation
from agents.graphql.queries import AgentQuery
from agents.graphql.subscriptions import AgentSubscription
from projects.graphql.mutations import ProjectMutation
from projects.graphql.queries import ProjectQuery


@strawberry.type
class Query(AccountQuery, ProjectQuery, AgentQuery):
    pass


@strawberry.type
class Mutation(AccountMutation, ProjectMutation, AgentMutation):
    pass


@strawberry.type
class Subscription(AgentSubscription):
    pass


schema = strawberry.Schema(
    query=Query, mutation=Mutation, subscription=Subscription
)
