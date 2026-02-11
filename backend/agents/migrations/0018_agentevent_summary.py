from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0017_agent_role_and_config"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentevent",
            name="summary",
            field=models.CharField(blank=True, default="", max_length=200),
            preserve_default=False,
        ),
    ]
