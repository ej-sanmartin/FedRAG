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
# Uncomment when Bedrock Knowledge Base resources are available in the provider
/*
resource "aws_bedrock_knowledge_base" "main" {
  name     = "${var.project_name}-knowledge-base"
  role_arn = aws_iam_role.bedrock_kb_role.arn

  description = "FedRag Privacy-First RAG Assistant Knowledge Base"

  knowledge_base_configuration {
    vector_knowledge_base_configuration {
      embedding_model_arn = "arn:aws:bedrock:${data.aws_region.current.name}::foundation-model/amazon.titan-embed-text-v2:0"
    }
    type = "VECTOR"
  }

  storage_configuration {
    opensearch_serverless_configuration {
      collection_arn    = aws_opensearchserverless_collection.main.arn
      vector_index_name = "fedrag-vector-index"
      field_mapping {
        vector_field   = "vector"
        text_field     = "text"
        metadata_field = "metadata"
      }
    }
    type = "OPENSEARCH_SERVERLESS"
  }

  tags = {
    Name        = "${var.project_name}-knowledge-base"
    Environment = var.environment
  }

  depends_on = [
    aws_iam_role_policy_attachment.bedrock_kb_s3,
    aws_iam_role_policy_attachment.bedrock_kb_opensearch,
    aws_iam_role_policy_attachment.bedrock_kb_model,
    aws_opensearchserverless_collection.main
  ]
}

# Bedrock Knowledge Base Data Source
resource "aws_bedrock_knowledge_base_data_source" "main" {
  knowledge_base_id = aws_bedrock_knowledge_base.main.id
  name              = "${var.project_name}-s3-data-source"

  description = "S3 data source for FedRag knowledge base corpus"

  data_source_configuration {
    s3_configuration {
      bucket_arn = aws_s3_bucket.corpus.arn

      # Optional: specify inclusion prefixes if needed
      # inclusion_prefixes = ["documents/"]
    }
    type = "S3"
  }

  # Optional: Configure chunking strategy
  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "FIXED_SIZE"
      fixed_size_chunking_configuration {
        max_tokens         = 300
        overlap_percentage = 20
      }
    }
  }

  depends_on = [
    aws_bedrock_knowledge_base.main,
    aws_s3_bucket.corpus
  ]
}
*/

# Data sources for current AWS account and region
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

