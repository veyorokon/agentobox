"""Add last_delivered_event_id cursor to Agent for reliable backfill."""

from django.db import migrations, models


def backfill_cursor(apps, schema_editor):
    """Set cursor to max StreamEvent.id per agent so existing agents
    don't replay their entire history on next reconnect."""
    Agent = apps.get_model("agents", "Agent")
    StreamEvent = apps.get_model("agents", "StreamEvent")

    for agent in Agent.objects.all():
        max_id = (
            StreamEvent.objects.filter(agent_id=agent.id, event_type="user")
            .order_by("-id")
            .values_list("id", flat=True)
            .first()
        )
        if max_id:
            agent.last_delivered_event_id = max_id
            agent.save(update_fields=["last_delivered_event_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("agents", "0043_add_is_canonical_to_streamevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="last_delivered_event_id",
            field=models.BigIntegerField(default=0),
        ),
        migrations.RunPython(backfill_cursor, migrations.RunPython.noop),
    ]
