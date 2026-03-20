import pytest
from asgiref.sync import sync_to_async
from django.contrib.auth import get_user_model
from django.test import RequestFactory

from projects.models import Project
from schema import schema


pytestmark = pytest.mark.integration


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_project_query_exposes_theme_document_and_derived_tokens():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="theme-doc-user", password="test")
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Theme Project",
        owner=user,
    )
    await sync_to_async(project.set_theme_document, thread_sensitive=True)(
        theme="nord",
        mode="dark",
        overrides={"accent": "#ff00aa"},
    )
    await sync_to_async(project.save, thread_sensitive=True)(
        update_fields=["theme_document", "theme_tokens"]
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    result = await schema.execute(
        """
        query ($id: ID!) {
          project(id: $id) {
            id
            themeDocument
            themeTokens
          }
        }
        """,
        variable_values={"id": str(project.id)},
        context_value={"request": request},
    )

    assert result.errors is None
    document = result.data["project"]["themeDocument"]
    tokens = result.data["project"]["themeTokens"]
    assert document["theme"] == "nord"
    assert document["mode"] == "dark"
    assert document["overrides"] == {"accent": "#ff00aa"}
    assert tokens["surface"] == "#2e3440"
    assert tokens["accent"] == "#ff00aa"


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_set_project_theme_accepts_builtin_identity_only():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="theme-mutation-user", password="test")
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Theme Mutation",
        owner=user,
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    result = await schema.execute(
        """
        mutation ($input: SetProjectThemeInput!) {
          setProjectTheme(input: $input)
        }
        """,
        variable_values={
            "input": {
                "projectId": str(project.id),
                "theme": "ember",
                "mode": "dark",
            }
        },
        context_value={"request": request},
    )

    assert result.errors is None
    assert result.data == {"setProjectTheme": True}

    await sync_to_async(project.refresh_from_db, thread_sensitive=True)()
    assert project.theme_document["theme"] == "ember"
    assert project.theme_document["mode"] == "dark"
    assert project.theme_document.get("overrides") in (None, {})
    assert project.resolved_theme_tokens()["surface"] == "#282828"


@pytest.mark.asyncio
@pytest.mark.django_db(transaction=True)
async def test_set_project_theme_legacy_token_payload_normalizes_to_document():
    user = await sync_to_async(
        get_user_model().objects.create_user, thread_sensitive=True
    )(username="theme-legacy-user", password="test")
    project = await sync_to_async(Project.objects.create, thread_sensitive=True)(
        name="Legacy Theme Mutation",
        owner=user,
    )

    request = RequestFactory().post("/graphql")
    request.user = user

    result = await schema.execute(
        """
        mutation ($input: SetProjectThemeInput!) {
          setProjectTheme(input: $input)
        }
        """,
        variable_values={
            "input": {
                "projectId": str(project.id),
                "tokens": {
                    "surface": "#2e3440",
                    "accent": "#88c0d0",
                },
            }
        },
        context_value={"request": request},
    )

    assert result.errors is None
    assert result.data == {"setProjectTheme": True}

    await sync_to_async(project.refresh_from_db, thread_sensitive=True)()
    assert project.theme_document["theme"] == "nord"
    assert project.theme_document["mode"] == "dark"
    assert project.resolved_theme_tokens()["surface"] == "#2e3440"
