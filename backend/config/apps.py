from django.apps import AppConfig


class ConfigConfig(AppConfig):
    """Config app - manages telemetry, logging, and system settings."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "config"

    def ready(self):
        """Start queue listener for async logging performance."""
        from config.telemetry import start_queue_listener

        start_queue_listener()
