# Compute module — DigitalOcean Droplet for running Docker Compose stack

terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "size" {
  type    = string
  default = "s-2vcpu-2gb"
}

variable "ssh_key_ids" {
  type        = list(string)
  description = "DigitalOcean SSH key IDs (fingerprints or numeric IDs)"
}

variable "vpc_id" {
  type = string
}

variable "region" {
  type    = string
  default = "nyc1"
}

# --- User Data (bootstrap Docker + Caddy) ---

locals {
  deploy_user = "agentobox"
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Docker
    curl -fsSL https://get.docker.com | sh
    groupadd -f docker

    # Canonical deploy user for CI/CD and operator access
    id -u ${local.deploy_user} >/dev/null 2>&1 || useradd -m -s /bin/bash ${local.deploy_user}
    usermod -aG docker ${local.deploy_user}

    # Docker Compose plugin
    apt-get install -y docker-compose-plugin

    # Caddy
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy

    # Reuse the droplet's injected SSH key for the deploy user.
    if [ -f /root/.ssh/authorized_keys ]; then
      install -d -m 0700 -o ${local.deploy_user} -g ${local.deploy_user} /home/${local.deploy_user}/.ssh
      install -m 0600 -o ${local.deploy_user} -g ${local.deploy_user} /root/.ssh/authorized_keys /home/${local.deploy_user}/.ssh/authorized_keys
    fi

    # Harden the SSH admission path for CI/CD and operator access under
    # internet background noise. The stock defaults can randomly drop new
    # connections when the daemon is already handling unauthenticated probes.
    cat >/etc/ssh/sshd_config.d/60-agentobox.conf <<'SSHEOF'
    MaxStartups 50:30:200
    MaxSessions 50
    LoginGraceTime 30
    SSHEOF
    systemctl restart ssh

    # App directory
    install -d -m 0775 -o ${local.deploy_user} -g docker /opt/agentobox
  EOF
}

# --- Droplet ---

resource "digitalocean_droplet" "app" {
  name     = "${var.project}-${var.environment}"
  image    = "ubuntu-24-04-x64"
  size     = var.size
  region   = var.region
  vpc_uuid = var.vpc_id
  ssh_keys = var.ssh_key_ids

  user_data  = local.user_data
  backups    = true
  monitoring = true

  tags = ["${var.project}", "${var.environment}"]
}

# --- Reserved IP ---

resource "digitalocean_reserved_ip" "app" {
  region     = var.region
  droplet_id = digitalocean_droplet.app.id
}

# --- Firewall ---

resource "digitalocean_firewall" "app" {
  name        = "${var.project}-${var.environment}"
  droplet_ids = [digitalocean_droplet.app.id]

  # SSH
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTP
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # All outbound
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# --- Outputs ---

output "droplet_id" {
  value = digitalocean_droplet.app.id
}

output "public_ip" {
  value = digitalocean_reserved_ip.app.ip_address
}

output "ipv4_address" {
  value = digitalocean_droplet.app.ipv4_address
}

output "deploy_user" {
  value = local.deploy_user
}
