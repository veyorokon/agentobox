# Compute module — EC2 instance for running Docker Compose stack

variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "key_pair_name" {
  type = string
}

variable "subnet_id" {
  type = string
}

variable "security_group_ids" {
  type = list(string)
}

variable "domain" {
  type = string
}

# --- AMI (latest Ubuntu 24.04) ---

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# --- User Data (bootstrap Docker + Caddy) ---

locals {
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Docker
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu

    # Docker Compose plugin
    apt-get install -y docker-compose-plugin

    # Caddy
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy

    # App directory
    mkdir -p /opt/agentobox
    chown ubuntu:ubuntu /opt/agentobox
  EOF
}

# --- EC2 Instance ---

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = var.key_pair_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
  user_data              = local.user_data

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = {
    Name        = "${var.project}-${var.environment}"
    Project     = var.project
    Environment = var.environment
  }
}

# --- Elastic IP ---

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = "${var.project}-${var.environment}-eip"
  }
}

# --- Outputs ---

output "instance_id" {
  value = aws_instance.app.id
}

output "instance_arn" {
  value = aws_instance.app.arn
}

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "public_dns" {
  value = aws_eip.app.public_dns
}
