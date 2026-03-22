from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0002_project_deleted_at"),
        ("agents", "0005_add_desired_status"),
    ]

    operations = [
        migrations.CreateModel(
            name="RuntimeSegment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(default="", max_length=32)),
                ("sandbox_id", models.CharField(blank=True, db_index=True, max_length=100)),
                ("started_at", models.DateTimeField()),
                ("ended_at", models.DateTimeField()),
                ("compute_seconds", models.BigIntegerField(default=0)),
                ("close_reason", models.CharField(blank=True, default="", max_length=64)),
                ("cpu_cores", models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                ("memory_mb", models.IntegerField(default=0)),
                ("metadata_json", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="runtime_segments", to="agents.agent")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="runtime_segments", to="projects.project")),
            ],
            options={
                "ordering": ["-started_at"],
            },
        ),
        migrations.AddIndex(
            model_name="runtimesegment",
            index=models.Index(fields=["agent", "started_at"], name="agents_runt_agent_i_42ec2e_idx"),
        ),
        migrations.AddIndex(
            model_name="runtimesegment",
            index=models.Index(fields=["project", "started_at"], name="agents_runt_project_6b32e2_idx"),
        ),
        migrations.AddIndex(
            model_name="runtimesegment",
            index=models.Index(fields=["provider", "started_at"], name="agents_runt_provider_339550_idx"),
        ),
        migrations.AddIndex(
            model_name="runtimesegment",
            index=models.Index(fields=["sandbox_id"], name="agents_runt_sandbox_3fda64_idx"),
        ),
        migrations.AddConstraint(
            model_name="runtimesegment",
            constraint=models.UniqueConstraint(
                fields=("agent", "provider", "sandbox_id", "started_at"),
                name="agents_runtime_segment_unique_start",
            ),
        ),
    ]
