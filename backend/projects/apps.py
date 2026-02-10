from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    name = "projects"

    def ready(self):
        """Register signal handlers on app startup."""
        import projects.signals  # noqa: F401
