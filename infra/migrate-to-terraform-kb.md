# Migrating to Terraform-Managed Knowledge Base

This guide helps migrate from manually created knowledge base to Terraform-managed resources.

## Prerequisites

- AWS CLI with Bedrock support (newer version)
- Terraform AWS provider >= 5.31.0
- Access to the device that can run Bedrock commands

## Steps

### 1. Update Provider Version

In `providers.tf`, ensure you have:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.31"  # or newer
    }
  }
}
```

### 2. Uncomment Knowledge Base Resources

In `kb.tf`, uncomment the knowledge base resources:

```bash
# Remove the # comments from the aws_bedrock_knowledge_base and 
# aws_bedrock_knowledge_base_data_source resources
```

### 3. Import Existing Knowledge Base (Optional)

If you want to manage the existing KB with Terraform:

```bash
# Import the existing knowledge base
terraform import aws_bedrock_knowledge_base.main 8NVMKLDWRL

# Import the data source (you'll need the data source ID from AWS console)
terraform import aws_bedrock_knowledge_base_data_source.main <data-source-id>
```

### 4. Or Create New Knowledge Base

If you prefer to create a new one:

```bash
# Update terraform.tfvars
knowledge_base_id = "terraform-managed"

# Apply the changes
terraform plan
terraform apply
```

### 5. Update Lambda Environment

The Lambda will automatically use the new KB ID once Terraform creates it.

## Current Status

- Knowledge Base ID: `8NVMKLDWRL` (manually created)
- Status: Working with manual KB
- Ready for migration: Yes (when on compatible device)

## Rollback Plan

If issues occur, you can always:

1. Comment out the KB resources again
2. Set `knowledge_base_id = "8NVMKLDWRL"` in terraform.tfvars
3. Run `terraform apply`