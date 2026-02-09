from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0013_agentfeedback"),
    ]

    operations = [
        # --- Agent model: add stream-json relay fields ---
        migrations.AddField(
            model_name="agent",
            name="session_cost_usd",
            field=models.DecimalField(decimal_places=6, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="agent",
            name="capabilities",
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="agent",
            name="pending_input",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="agent",
            name="pending_signal",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="agent",
            name="relay_token",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="agent",
            name="last_heartbeat_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        # --- Message model ---
        migrations.CreateModel(
            name="Message",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("message_id", models.CharField(db_index=True, max_length=100)),
                ("session_id", models.CharField(db_index=True, max_length=100)),
                ("role", models.CharField(max_length=10)),
                ("model", models.CharField(blank=True, max_length=100)),
                ("parts", models.JSONField(default=list)),
                ("usage", models.JSONField(blank=True, null=True)),
                ("parent_tool_use_id", models.CharField(blank=True, max_length=100)),
                ("stop_reason", models.CharField(blank=True, max_length=20)),
                ("turn_number", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agent",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="stream_messages",
                        to="agents.agent",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="message",
            index=models.Index(fields=["agent", "session_id", "turn_number"], name="agents_mess_agent_i_idx"),
        ),
        migrations.AddConstraint(
            model_name="message",
            constraint=models.UniqueConstraint(fields=("agent", "message_id"), name="unique_agent_message_id"),
        ),
        # --- SessionResult model ---
        migrations.CreateModel(
            name="SessionResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("session_id", models.CharField(max_length=100)),
                ("is_error", models.BooleanField(default=False)),
                ("total_cost_usd", models.DecimalField(decimal_places=6, default=0, max_digits=10)),
                ("duration_ms", models.IntegerField(default=0)),
                ("duration_api_ms", models.IntegerField(default=0)),
                ("num_turns", models.IntegerField(default=0)),
                ("model_usage", models.JSONField(default=dict)),
                ("permission_denials", models.JSONField(default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agent",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="session_results",
                        to="agents.agent",
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="sessionresult",
            constraint=models.UniqueConstraint(fields=("agent", "session_id"), name="unique_session_result"),
        ),
    ]
