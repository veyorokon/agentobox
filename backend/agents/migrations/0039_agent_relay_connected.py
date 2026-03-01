from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0038_add_allowed_tools"),
    ]

    operations = [
        migrations.AddField(
            model_name="agent",
            name="relay_connected",
            field=models.BooleanField(default=False),
        ),
    ]
