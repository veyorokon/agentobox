import secrets

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    api_key = models.CharField(max_length=64, unique=True, null=True, blank=True)

    def generate_api_key(self):
        self.api_key = secrets.token_urlsafe(48)
        self.save(update_fields=["api_key"])
        return self.api_key
