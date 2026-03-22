from django.db import migrations, models


def forwards(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    default_theme = {"schema_version": "1", "theme": "claude", "mode": "dark"}
    preset_matches = {
        ("surface", "hsl(60 2.7% 14.5%)"): ("claude", "dark"),
        ("surface", "#2B303B"): ("blyss", "dark"),
        ("surface", "#191724"): ("rose-pine", "dark"),
        ("surface", "#282828"): ("ember", "dark"),
        ("surface", "#2e3440"): ("nord", "dark"),
    }

    for project in Project.objects.all():
        tokens = project.theme_tokens or {}
        document = dict(default_theme)
        if isinstance(tokens, dict) and tokens:
            inferred = None
            for key, value in tokens.items():
                inferred = preset_matches.get((str(key), str(value)))
                if inferred is not None:
                    break
            if inferred is not None:
                document["theme"], document["mode"] = inferred
            document["overrides"] = dict(tokens)
        project.theme_document = document
        project.save(update_fields=["theme_document"])


def backwards(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    for project in Project.objects.all():
        document = project.theme_document or {}
        overrides = document.get("overrides") if isinstance(document, dict) else {}
        project.theme_tokens = overrides if isinstance(overrides, dict) else {}
        project.save(update_fields=["theme_tokens"])


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0002_project_deleted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="theme_document",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(forwards, backwards),
    ]
