# Database module — managed Postgres RDS instance

variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_name" {
  type    = string
  default = "agentobox"
}

variable "master_username" {
  type    = string
  default = "agentobox"
}

variable "master_password" {
  type      = string
  sensitive = true
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the DB subnet group (must span at least 2 AZs)"
}

variable "vpc_id" {
  type = string
}

variable "app_security_group_id" {
  type        = string
  description = "Security group ID of the app layer (allowed to connect)"
}

variable "skip_final_snapshot" {
  type    = bool
  default = true
}

# --- DB Subnet Group ---

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "${var.project}-${var.environment}"
    Project     = var.project
    Environment = var.environment
  }
}

# --- Security Group ---

resource "aws_security_group" "db" {
  name_prefix = "${var.project}-${var.environment}-db-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project}-${var.environment}-db-sg"
    Project     = var.project
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

# --- RDS Instance ---

resource "aws_db_instance" "main" {
  identifier = "${var.project}-${var.environment}"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.master_username
  password = var.master_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  multi_az            = false
  publicly_accessible = false

  backup_retention_period = 7

  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.project}-${var.environment}-final"

  tags = {
    Name        = "${var.project}-${var.environment}"
    Project     = var.project
    Environment = var.environment
  }
}

# --- Outputs ---

output "endpoint" {
  value       = aws_db_instance.main.endpoint
  description = "hostname:port"
}

output "address" {
  value       = aws_db_instance.main.address
  description = "Hostname only"
}

output "port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}
