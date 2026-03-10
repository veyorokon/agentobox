# DNS module — Route53 records

variable "domain" {
  type        = string
  description = "Domain name (e.g. dev.agentobox.com)"
}

variable "zone_id" {
  type        = string
  description = "Route53 hosted zone ID"
}

variable "public_ip" {
  type        = string
  description = "Elastic IP of the EC2 instance"
}

# --- A Record ---

resource "aws_route53_record" "app" {
  zone_id = var.zone_id
  name    = var.domain
  type    = "A"
  ttl     = 300
  records = [var.public_ip]
}

# --- Outputs ---

output "fqdn" {
  value = aws_route53_record.app.fqdn
}
