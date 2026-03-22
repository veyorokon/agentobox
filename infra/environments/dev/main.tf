# Dev environment — DigitalOcean compute + database, Route53 DNS

terraform {
  required_version = ">= 1.5"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "agentobox-tfstate"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    profile        = "agentobox"
    dynamodb_table = "agentobox-tflock"
  }
}

provider "digitalocean" {
  token = var.do_token
}

provider "aws" {
  region  = "us-east-1"
  profile = "agentobox"
}

# --- Variables ---

variable "do_token" {
  type      = string
  sensitive = true
}

variable "region" {
  type    = string
  default = "nyc1"
}

variable "domain" {
  type = string
}

variable "zone_id" {
  type        = string
  description = "Route53 hosted zone ID"
}

variable "ssh_key_ids" {
  type        = list(string)
  description = "DO SSH key fingerprints or IDs"
}

variable "droplet_size" {
  type    = string
  default = "s-2vcpu-2gb"
}

locals {
  project     = "agentobox"
  environment = "dev"
}

# --- VPC ---

resource "digitalocean_vpc" "main" {
  name     = "${local.project}-${local.environment}"
  region   = var.region
  ip_range = "10.120.0.0/20"
}

# --- Modules ---

module "compute" {
  source = "../../modules/compute"

  project     = local.project
  environment = local.environment
  size        = var.droplet_size
  region      = var.region
  vpc_id      = digitalocean_vpc.main.id
  ssh_key_ids = var.ssh_key_ids
}

module "database" {
  source = "../../modules/database"

  project     = local.project
  environment = local.environment
  region      = var.region
  vpc_id      = digitalocean_vpc.main.id
}

module "dns" {
  source = "../../modules/dns"

  domain    = var.domain
  zone_id   = var.zone_id
  public_ip = module.compute.public_ip
}

# --- Outputs ---

output "public_ip" {
  value = module.compute.public_ip
}

output "domain" {
  value = module.dns.fqdn
}

output "droplet_id" {
  value = module.compute.droplet_id
}

output "ssh_command" {
  value = "ssh ${module.compute.deploy_user}@${module.compute.public_ip}"
}

output "deploy_user" {
  value = module.compute.deploy_user
}

output "db_host" {
  value = module.database.host
}

output "db_uri" {
  value     = module.database.uri
  sensitive = true
}
