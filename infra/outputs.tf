# Terraform Outputs for FedRag Infrastructure

# Knowledge Base Outputs
output "knowledge_base_id" {
  description = "The ID of the Bedrock Knowledge Base"
  value       = var.knowledge_base_id
}

output "knowledge_base_arn" {
  description = "The ARN of the Bedrock Knowledge Base (placeholder)"
  value       = "arn:aws:bedrock:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:knowledge-base/${var.knowledge_base_id}"
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
  value       = aws_opensearchserverless_collection.main.arn
}

output "opensearch_collection_endpoint" {
  description = "The endpoint of the OpenSearch Serverless collection"
  value       = aws_opensearchserverless_collection.main.collection_endpoint
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

# Guardrail Outputs
output "guardrail_id" {
  description = "The ID of the Bedrock Guardrail"
  value       = aws_bedrock_guardrail.main.guardrail_id
}

output "guardrail_arn" {
  description = "The ARN of the Bedrock Guardrail"
  value       = aws_bedrock_guardrail.main.guardrail_arn
}

output "guardrail_version" {
  description = "The version of the Bedrock Guardrail"
  value       = aws_bedrock_guardrail_version.main.version
}

# API Infrastructure Outputs
output "api_gateway_url" {
  description = "The URL of the API Gateway"
  value       = aws_apigatewayv2_stage.main.invoke_url
}

output "api_gateway_id" {
  description = "The ID of the API Gateway"
  value       = aws_apigatewayv2_api.main.id
}

output "lambda_function_name" {
  description = "The name of the Lambda function"
  value       = aws_lambda_function.api.function_name
}

output "lambda_function_arn" {
  description = "The ARN of the Lambda function"
  value       = aws_lambda_function.api.arn
}

output "lambda_execution_role_arn" {
  description = "The ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_execution_role.arn
}