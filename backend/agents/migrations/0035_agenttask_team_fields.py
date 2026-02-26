"""Add active_form, metadata, blocks, blocked_by to AgentTask.

Aligns AgentTask with Claude Code's native TaskCreate/TaskUpdate schemas.
All fields have defaults — no data migration needed.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0034_remove_display_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="agenttask",
            name="active_form",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="agenttask",
            name="metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="agenttask",
            name="blocks",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="agenttask",
            name="blocked_by",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
