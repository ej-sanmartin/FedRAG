# FedRag Infrastructure

This directory contains Terraform configuration for the FedRag Privacy-First RAG Assistant infrastructure.

## Prerequisites

1. **AWS CLI configured** with appropriate credentials
2. **Terraform >= 1.0** installed
3. **Bedrock model access** enabled for:
   - `amazon.titan-embed-text-v2:0` (for embeddings)
   - `anthropic.claude-3-5-sonnet-20240620-v1:0` (for generation)

## Quick Start

1. Copy the example variables file:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Edit `terraform.tfvars` with your desired configuration

3. Initialize Terraform:
   ```bash
   terraform init
   ```

4. Plan the deployment:
   ```bash
   terraform plan
   ```

5. Apply the configuration:
   ```bash
   terraform apply
   ```

## Architecture Components

### Knowledge Base Infrastructure (`kb.tf`)

- **S3 Corpus Bucket**: Stores the document corpus with versioning and encryption
- **OpenSearch Serverless**: Vector search collection using aws-ia module
- **Bedrock Knowledge Base**: Configured with Titan embeddings model
- **IAM Roles and Policies**: Least-privilege access for service integration

### Key Features

- **Security**: All resources use encryption at rest and in transit
- **Compliance**: Public access blocked on S3, proper IAM policies
- **Scalability**: Serverless OpenSearch with auto-scaling capabilities
- **Cost Optimization**: Pay-per-use serverless architecture

## Configuration

### Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `project_name` | Project name prefix | `fedrag` | No |
| `environment` | Environment (dev/staging/prod) | `dev` | No |
| `aws_region` | AWS region | `us-east-1` | No |
| `common_tags` | Common resource tags | See variables.tf | No |

### Outputs

| Output | Description |
|--------|-------------|
| `knowledge_base_id` | Bedrock Knowledge Base ID |
| `knowledge_base_arn` | Bedrock Knowledge Base ARN |
| `corpus_bucket_name` | S3 corpus bucket name |
| `opensearch_collection_arn` | OpenSearch collection ARN |

## Post-Deployment Steps

1. **Upload Documents**: Add documents to the S3 corpus bucket
2. **Sync Knowledge Base**: Trigger ingestion in Bedrock console
3. **Test Vector Search**: Verify embeddings are created successfully

## Troubleshooting

### Common Issues

1. **Bedrock Model Access**: Ensure models are enabled in your AWS account
2. **IAM Permissions**: Verify your AWS credentials have sufficient permissions
3. **Region Availability**: Confirm Bedrock services are available in your region

### Useful Commands

```bash
# Check Terraform state
terraform show

# Destroy infrastructure (careful!)
terraform destroy

# Format Terraform files
terraform fmt

# Validate configuration
terraform validate
```

## Security Considerations

- S3 bucket has public access blocked
- IAM roles follow least-privilege principle
- OpenSearch collection uses encryption
- All resources are tagged for compliance tracking

## Cost Optimization

- OpenSearch Serverless: Pay only for usage
- S3: Intelligent tiering can be enabled
- Bedrock: Pay per API call and token usage
- No always-on compute resources