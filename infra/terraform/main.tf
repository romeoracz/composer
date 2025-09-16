terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# RDS Postgres stub
resource "aws_db_instance" "composr_db" {
  allocated_storage    = 20
  engine               = "postgres"
  engine_version       = "15"
  instance_class       = "db.t3.micro"
  username             = "composr"
  password             = "change-me"
  skip_final_snapshot  = true
  publicly_accessible  = false
}

# ElastiCache Redis stub
resource "aws_elasticache_cluster" "composr_redis" {
  cluster_id           = "composr-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
}
