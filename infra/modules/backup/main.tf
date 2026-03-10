# Backup module — AWS Backup for EBS volumes

variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "target_arns" {
  type        = list(string)
  description = "ARNs of resources to back up"
}

# --- IAM Role ---

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.project}-${var.environment}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

# --- Backup Vault ---

resource "aws_backup_vault" "main" {
  name = "${var.project}-${var.environment}"

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# --- Backup Plan ---

resource "aws_backup_plan" "daily" {
  name = "${var.project}-${var.environment}-daily"

  rule {
    rule_name         = "daily-5am-utc"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 5 * * ? *)"

    lifecycle {
      delete_after = 7
    }
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# --- Backup Selection ---

resource "aws_backup_selection" "main" {
  name         = "${var.project}-${var.environment}"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn

  resources = var.target_arns
}

# --- Outputs ---

output "backup_vault_name" {
  value = aws_backup_vault.main.name
}

output "backup_plan_id" {
  value = aws_backup_plan.daily.id
}
