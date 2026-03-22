from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0006_runtimesegment"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="runtime_status_projection",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
