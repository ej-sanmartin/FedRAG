# Variables for FedRag Infrastructure

variable "project_name" {
  description = "Name of the project, used as prefix for resources"
  type        = string
  default     = "fedrag"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", var.project_name))
    error_message = "Project name must start with a letter, contain only lowercase letters, numbers, and hyphens, and end with a letter or number."
  }
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region for resource deployment"
  type        = string
  default     = "us-east-1"
}

# Tags applied to all resources
variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default = {
    Project     = "FedRag"
    ManagedBy   = "Terraform"
    Application = "Privacy-First RAG Assistant"
  }
}

# Cognito Configuration Variables (now created by Terraform)
# These are no longer input variables since we create the Cognito resources

# Knowledge Base Configuration Variable
variable "knowledge_base_id" {
  description = "Bedrock Knowledge Base ID (use 'terraform-managed' to create via Terraform, or provide existing KB ID)"
  type        = string
  default     = "8NVMKLDWRL"  # Current manually created KB ID
}