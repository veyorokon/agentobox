# Database module — DigitalOcean Managed Postgres

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
  default = "db-s-1vcpu-1gb"
}

variable "region" {
  type    = string
  default = "nyc1"
}

variable "vpc_id" {
  type = string
}

variable "db_name" {
  type    = string
  default = "agentobox"
}

# --- Managed Postgres Cluster ---

resource "digitalocean_database_cluster" "main" {
  name       = "${var.project}-${var.environment}"
  engine     = "pg"
  version    = "16"
  size       = var.size
  region     = var.region
  node_count = 1

  private_network_uuid = var.vpc_id

  tags = ["${var.project}", "${var.environment}"]
}

resource "digitalocean_database_db" "main" {
  cluster_id = digitalocean_database_cluster.main.id
  name       = var.db_name
}

# --- Firewall (restrict to droplet VPC) ---

resource "digitalocean_database_firewall" "main" {
  cluster_id = digitalocean_database_cluster.main.id

  rule {
    type  = "tag"
    value = var.project
  }
}

# --- Outputs ---

output "host" {
  value = digitalocean_database_cluster.main.private_host
}

output "port" {
  value = digitalocean_database_cluster.main.port
}

output "database" {
  value = digitalocean_database_db.main.name
}

output "user" {
  value = digitalocean_database_cluster.main.user
}

output "password" {
  value     = digitalocean_database_cluster.main.password
  sensitive = true
}

output "uri" {
  value     = digitalocean_database_cluster.main.private_uri
  sensitive = true
  description = "Full connection string (private network)"
}
