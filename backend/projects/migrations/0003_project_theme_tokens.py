from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0002_remove_project_anthropic_api_key_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="theme_tokens",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
