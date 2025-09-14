# Knowledge Base Infrastructure
# This file creates the S3 corpus bucket, OpenSearch Serverless collection,
# Bedrock Knowledge Base, and associated IAM roles and policies

# S3 Corpus Bucket Configuration
resource "aws_s3_bucket" "corpus" {
  bucket = "${var.project_name}-corpus-${random_id.bucket_suffix.hex}"

  tags = {
    Name        = "${var.project_name}-corpus"
    Environment = var.environment
    Purpose     = "Knowledge Base Document Corpus"
  }
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "corpus" {
  bucket = aws_s3_bucket.corpus.id
  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Server-Side Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# S3 Bucket Public Access Block
resource "aws_s3_bucket_public_access_block" "corpus" {
  bucket = aws_s3_bucket.corpus.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OpenSearch Serverless Collection for Vector Search
resource "aws_opensearchserverless_collection" "main" {
  name = "${var.project_name}-kb-collection"
  type = "VECTORSEARCH"

  tags = {
    Name        = "${var.project_name}-kb-collection"
    Environment = var.environment
    Purpose     = "Knowledge Base Vector Search"
  }

  depends_on = [
    aws_opensearchserverless_security_policy.encryption,
    aws_opensearchserverless_access_policy.data_access
  ]
}

# Security Policy for Encryption
resource "aws_opensearchserverless_security_policy" "encryption" {
  name = "${var.project_name}-kb-security-policy"
  type = "encryption"

  policy = jsonencode({
    Rules = [
      {
        Resource = [
          "collection/${var.project_name}-kb-collection"
        ]
        ResourceType = "collection"
      }
    ]
    AWSOwnedKey = true
  })
}

# Network Policy for Access
resource "aws_opensearchserverless_security_policy" "network" {
  name = "${var.project_name}-kb-network-policy"
  type = "network"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource = [
            "collection/${var.project_name}-kb-collection"
          ]
          ResourceType = "collection"
        }
      ]
      AllowFromPublic = true
    }
  ])
}

# Data Access Policy
resource "aws_opensearchserverless_access_policy" "data_access" {
  name = "${var.project_name}-kb-data-policy"
  type = "data"

  policy = jsonencode([
    {
      Rules = [
        {
          Resource = [
            "collection/${var.project_name}-kb-collection"
          ]
          Permission = [
            "aoss:CreateCollectionItems",
            "aoss:DeleteCollectionItems",
            "aoss:UpdateCollectionItems",
            "aoss:DescribeCollectionItems"
          ]
          ResourceType = "collection"
        },
        {
          Resource = [
            "index/${var.project_name}-kb-collection/*"
          ]
          Permission = [
            "aoss:CreateIndex",
            "aoss:DeleteIndex",
            "aoss:UpdateIndex",
            "aoss:DescribeIndex",
            "aoss:ReadDocument",
            "aoss:WriteDocument"
          ]
          ResourceType = "index"
        }
      ]
      Principal = [
        aws_iam_role.bedrock_kb_role.arn,
        aws_iam_role.bedrock_kb_execution_role.arn
      ]
    }
  ])
}

# IAM Role for Bedrock Knowledge Base
resource "aws_iam_role" "bedrock_kb_role" {
  name = "${var.project_name}-bedrock-kb-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-bedrock-kb-role"
    Environment = var.environment
  }
}

# IAM Policy for Bedrock Knowledge Base S3 Access
resource "aws_iam_policy" "bedrock_kb_s3_policy" {
  name        = "${var.project_name}-bedrock-kb-s3-policy"
  description = "Policy for Bedrock Knowledge Base to access S3 corpus bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.corpus.arn,
          "${aws_s3_bucket.corpus.arn}/*"
        ]
      }
    ]
  })
}

# IAM Policy for Bedrock Knowledge Base OpenSearch Access
resource "aws_iam_policy" "bedrock_kb_opensearch_policy" {
  name        = "${var.project_name}-bedrock-kb-opensearch-policy"
  description = "Policy for Bedrock Knowledge Base to access OpenSearch Serverless"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "aoss:APIAccessAll"
        ]
        Resource = aws_opensearchserverless_collection.main.arn
      }
    ]
  })
}

# IAM Policy for Bedrock Model Access
resource "aws_iam_policy" "bedrock_kb_model_policy" {
  name        = "${var.project_name}-bedrock-kb-model-policy"
  description = "Policy for Bedrock Knowledge Base to access embedding models"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/amazon.titan-embed-text-v2:0"
        ]
      }
    ]
  })
}

# Attach policies to Bedrock KB role
resource "aws_iam_role_policy_attachment" "bedrock_kb_s3" {
  role       = aws_iam_role.bedrock_kb_role.name
  policy_arn = aws_iam_policy.bedrock_kb_s3_policy.arn
}

resource "aws_iam_role_policy_attachment" "bedrock_kb_opensearch" {
  role       = aws_iam_role.bedrock_kb_role.name
  policy_arn = aws_iam_policy.bedrock_kb_opensearch_policy.arn
}

resource "aws_iam_role_policy_attachment" "bedrock_kb_model" {
  role       = aws_iam_role.bedrock_kb_role.name
  policy_arn = aws_iam_policy.bedrock_kb_model_policy.arn
}

# IAM Role for Bedrock Knowledge Base Execution
resource "aws_iam_role" "bedrock_kb_execution_role" {
  name = "${var.project_name}-bedrock-kb-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "bedrock.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })

  tags = {
    Name        = "${var.project_name}-bedrock-kb-execution-role"
    Environment = var.environment
  }
}

# Bedrock Knowledge Base
# Note: These resources require AWS provider version with Bedrock support
# Bedrock Knowledge Base resources
# Note: These resources are not supported in AWS provider < 5.31.0 (my local dev environment)
# Knowledge Base created manually via AWS Console
# 
# Uncomment these when using AWS provider 5.31.0+:
#
# resource "aws_bedrock_knowledge_base" "main" {
#   name     = "${var.project_name}-knowledge-base"
#   role_arn = aws_iam_role.bedrock_kb_role.arn
#   ...
# }
#
# resource "aws_bedrock_knowledge_base_data_source" "main" {
#   knowledge_base_id = aws_bedrock_knowledge_base.main.id
#   ...
# }

# Data sources for current AWS account and region
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

