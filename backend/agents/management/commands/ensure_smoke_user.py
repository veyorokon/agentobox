"""Ensure a smoke test user exists for CI.

Usage:
    uv run python manage.py ensure_smoke_user --username demo --password demo

Creates the user if missing, always sets the password. No other data
is created — this is not seed_dev_data. For CI smoke tests only.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

User = get_user_model()


class Command(BaseCommand):
    help = "Ensure a smoke test user exists (CI only)"

    def add_arguments(self, parser):
        parser.add_argument("--username", default="demo")
        parser.add_argument("--password", default="demo")

    def handle(self, *args, **options):
        username = options["username"]
        password = options["password"]

        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": f"{username}@agentobox.dev"},
        )
        user.set_password(password)
        user.save()

        verb = "Created" if created else "Updated"
        self.stdout.write(f"{verb} smoke user: {username}")
