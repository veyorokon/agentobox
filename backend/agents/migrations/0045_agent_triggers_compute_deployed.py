"""Add trigger configuration, compute time tracking, and deployed_at to Agent.

triggers: JSONField (default=[]) — array of trigger objects that control
    what wakes an agent. Types: cron, webhook, manual.
compute_seconds: BigIntegerField (default=0) — accumulated container
    runtime in seconds, updated on agent stop/error/restart.
deployed_at: DateTimeField (nullable) — when the relay connected and agent
    became operational. Used to calculate elapsed compute time.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0044_agent_last_delivered_event_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="triggers",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="agent",
            name="compute_seconds",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agent",
            name="deployed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(
            migrations.RunPython.noop,
            migrations.RunPython.noop,
        ),
    ]
