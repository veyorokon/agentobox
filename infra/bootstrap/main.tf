# Bootstrap — creates the S3 bucket for Terraform state.
#
# Run once, manually:
#   cd infra/bootstrap
#   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY terraform init
#   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY terraform apply
#
# After this, all other environments can use the S3 backend.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state — this is the one thing that uses local state
}

provider "aws" {
  region  = "us-east-1"
  profile = "agentobox"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "agentobox-tfstate"

  tags = {
    Project = "agentobox"
    Purpose = "terraform-state"
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# DynamoDB table for state locking
resource "aws_dynamodb_table" "tflock" {
  name         = "agentobox-tflock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Project = "agentobox"
    Purpose = "terraform-state-lock"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.id
}

output "lock_table" {
  value = aws_dynamodb_table.tflock.name
}
