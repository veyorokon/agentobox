# Generated manually for agentobox

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0045_agent_triggers_compute_deployed"),
    ]

    operations = [
        migrations.RenameField(
            model_name="agenttask",
            old_name="subject",
            new_name="title",
        ),
        migrations.RenameField(
            model_name="agenttask",
            old_name="owner",
            new_name="assignee",
        ),
    ]
