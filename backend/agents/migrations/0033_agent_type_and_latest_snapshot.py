from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0032_add_agent_fields_and_team_feed_item"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="agent_type",
            field=models.CharField(default="claude-code", max_length=50),
        ),
        migrations.AddField(
            model_name="agent",
            name="latest_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
