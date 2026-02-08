from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0010_agentevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="workspace_path",
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
