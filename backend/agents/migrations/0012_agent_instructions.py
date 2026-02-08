from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0011_agent_workspace_path"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="instructions",
            field=models.TextField(blank=True),
        ),
    ]
