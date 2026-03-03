import strawberry
from strawberry.extensions import QueryDepthLimiter, SchemaExtension

from accounts.graphql.mutations import AccountMutation
from accounts.graphql.queries import AccountQuery
from agents.graphql.mutations import AgentMutation
from agents.graphql.queries import AgentQuery
from agents.graphql.subscriptions import AgentSubscription
from config.telemetry import GraphQLLoggingExtension
from projects.graphql.mutations import ProjectMutation
from projects.graphql.queries import ProjectQuery


# Make the logging extension a proper Strawberry extension at registration time
# (defined in telemetry.py as a mixin to avoid circular imports)
class _LoggingExt(GraphQLLoggingExtension, SchemaExtension):
    pass


@strawberry.type
class Query(AccountQuery, ProjectQuery, AgentQuery):
    pass


@strawberry.type
class Mutation(AccountMutation, ProjectMutation, AgentMutation):
    pass


@strawberry.type
class Subscription(AgentSubscription):
    pass


class _Schema(strawberry.Schema):
    """Suppress Strawberry's default error logging.

    Errors are logged with full context (classification, timing, user,
    variables) by GraphQLLoggingExtension instead.
    """

    def process_errors(self, errors, execution_context=None):
        pass


schema = _Schema(
    query=Query,
    mutation=Mutation,
    subscription=Subscription,
    extensions=[_LoggingExt, QueryDepthLimiter(max_depth=10)],
)
