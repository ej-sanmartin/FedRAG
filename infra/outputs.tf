# Terraform Outputs for FedRag Infrastructure

# Knowledge Base Outputs
output "knowledge_base_id" {
  description = "The ID of the Bedrock Knowledge Base"
  value       = aws_bedrock_knowledge_base.main.id
}

output "knowledge_base_arn" {
  description = "The ARN of the Bedrock Knowledge Base"
  value       = aws_bedrock_knowledge_base.main.arn
}

# S3 Corpus Bucket Outputs
output "corpus_bucket_name" {
  description = "The name of the S3 corpus bucket"
  value       = aws_s3_bucket.corpus.bucket
}

output "corpus_bucket_arn" {
  description = "The ARN of the S3 corpus bucket"
  value       = aws_s3_bucket.corpus.arn
}

# OpenSearch Serverless Outputs
output "opensearch_collection_arn" {
  description = "The ARN of the OpenSearch Serverless collection"
  value       = module.opensearch_serverless.collection_arn
}

output "opensearch_collection_endpoint" {
  description = "The endpoint of the OpenSearch Serverless collection"
  value       = module.opensearch_serverless.collection_endpoint
}

# IAM Role Outputs
output "bedrock_kb_role_arn" {
  description = "The ARN of the Bedrock Knowledge Base IAM role"
  value       = aws_iam_role.bedrock_kb_role.arn
}

output "bedrock_kb_execution_role_arn" {
  description = "The ARN of the Bedrock Knowledge Base execution IAM role"
  value       = aws_iam_role.bedrock_kb_execution_role.arn
}