from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0033_agent_type_and_latest_snapshot"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="agent",
            name="last_output",
        ),
        migrations.RemoveField(
            model_name="agent",
            name="live_action",
        ),
        migrations.RemoveField(
            model_name="agent",
            name="duration_ms",
        ),
        migrations.RemoveField(
            model_name="agent",
            name="num_turns",
        ),
    ]
