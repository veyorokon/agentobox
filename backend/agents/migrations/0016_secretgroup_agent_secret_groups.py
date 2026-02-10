# Generated manually for issue #39: Agent secrets

import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0015_rename_agents_mess_agent_i_idx_agents_mess_agent_i_44149d_idx"),
        ("projects", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="SecretGroup",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("name", models.CharField(max_length=100)),
                ("encrypted_data", models.BinaryField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="secret_groups",
                        to="projects.project",
                    ),
                ),
            ],
            options={
                "ordering": ["name"],
            },
        ),
        migrations.AddConstraint(
            model_name="secretgroup",
            constraint=models.UniqueConstraint(
                fields=("project", "name"),
                name="unique_project_secret_group",
            ),
        ),
        migrations.AddField(
            model_name="agent",
            name="secret_groups",
            field=models.ManyToManyField(
                blank=True,
                related_name="agents",
                to="agents.secretgroup",
            ),
        ),
    ]
