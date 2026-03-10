# Dev environment — wires modules together

terraform {
  required_version = ">= 1.5"

  required_providers {
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

provider "aws" {
  region  = var.region
  profile = "agentobox"
}

# --- Variables ---

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "domain" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "key_pair_name" {
  type = string
}

variable "allowed_ssh_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0"]
}

variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  project     = "agentobox"
  environment = "dev"
}

# --- Modules ---

module "networking" {
  source = "../../modules/networking"

  project           = local.project
  environment       = local.environment
  allowed_ssh_cidrs = var.allowed_ssh_cidrs
}

module "compute" {
  source = "../../modules/compute"

  project            = local.project
  environment        = local.environment
  instance_type      = var.instance_type
  key_pair_name      = var.key_pair_name
  subnet_id          = module.networking.public_subnet_id
  security_group_ids = [module.networking.app_security_group_id]
  domain             = var.domain
}

module "dns" {
  source = "../../modules/dns"

  domain    = var.domain
  zone_id   = var.zone_id
  public_ip = module.compute.public_ip
}

module "database" {
  source = "../../modules/database"

  project               = local.project
  environment           = local.environment
  master_password       = var.db_password
  subnet_ids            = module.networking.public_subnet_ids
  vpc_id                = module.networking.vpc_id
  app_security_group_id = module.networking.app_security_group_id
}

module "backup" {
  source = "../../modules/backup"

  project     = local.project
  environment = local.environment
  target_arns = [module.compute.instance_arn]
}

# --- Outputs ---

output "public_ip" {
  value = module.compute.public_ip
}

output "domain" {
  value = module.dns.fqdn
}

output "instance_id" {
  value = module.compute.instance_id
}

output "ssh_command" {
  value = "ssh ubuntu@${module.compute.public_ip}"
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "db_address" {
  value = module.database.address
}
