# FedRag Privacy RAG Assistant - Makefile
# Provides common development and deployment tasks

.PHONY: help install clean test lint package-lambda build-web deploy-infra destroy-infra upload-corpus validate-deployment

# Default target
help: ## Show this help message
	@echo "FedRag Privacy RAG Assistant - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Development Commands
install: ## Install all dependencies
	@echo "Installing dependencies..."
	pnpm install

clean: ## Clean build artifacts and node_modules
	@echo "Cleaning build artifacts..."
	rm -rf apps/api/dist apps/api/lambda-deployment.zip
	rm -rf apps/web/dist
	rm -rf node_modules apps/*/node_modules

test: ## Run all tests
	@echo "Running tests..."
	pnpm run test

test-e2e: ## Run end-to-end integration tests
	@echo "Running end-to-end integration tests..."
	pnpm run test:e2e

test-e2e-full: ## Run comprehensive end-to-end test suite
	@echo "Running comprehensive end-to-end test suite..."
	pnpm run test:e2e:full

lint: ## Run linting on all projects
	@echo "Running linters..."
	pnpm run lint

# Build Commands
package-lambda: ## Package Lambda function for deployment
	@echo "Packaging Lambda function..."
	./scripts/package-lambda.sh
	@echo "Lambda package created: apps/api/lambda-deployment.zip"

deploy-lambda: ## Deploy Lambda function (requires existing infrastructure)
	@echo "Deploying Lambda function..."
	./scripts/deploy-lambda.sh

deploy-lambda-quick: package-lambda deploy-lambda ## Package and deploy Lambda function quickly
	@echo "Quick Lambda deployment completed!"

build-web: ## Build web application for production
	@echo "Building web application..."
	cd apps/web && pnpm run build
	@echo "Web build completed: apps/web/dist"

# Infrastructure Commands
deploy-infra: ## Deploy infrastructure using Terraform
	@echo "Deploying infrastructure..."
	@if [ ! -f infra/terraform.tfvars ]; then \
		echo "Error: infra/terraform.tfvars not found. Copy from terraform.tfvars.example and configure."; \
		exit 1; \
	fi
	cd infra && terraform init
	cd infra && terraform plan -out=tfplan
	@echo ""
	@echo "Review the plan above. Continue with deployment? [y/N]"
	@read -r REPLY; \
	if [ "$$REPLY" = "y" ] || [ "$$REPLY" = "Y" ]; then \
		cd infra && terraform apply tfplan; \
		echo ""; \
		echo "Deployment completed! Check outputs above for URLs and resource IDs."; \
	else \
		echo "Deployment cancelled."; \
		cd infra && rm -f tfplan; \
	fi

destroy-infra: ## Destroy infrastructure using Terraform
	@echo "WARNING: This will destroy ALL infrastructure resources!"
	@echo "This action cannot be undone. Continue? [y/N]"
	@read -r REPLY; \
	if [ "$$REPLY" = "y" ] || [ "$$REPLY" = "Y" ]; then \
		cd infra && terraform destroy; \
		echo "Infrastructure destroyed."; \
	else \
		echo "Destruction cancelled."; \
	fi

plan-infra: ## Show Terraform plan without applying
	@echo "Generating Terraform plan..."
	@if [ ! -f infra/terraform.tfvars ]; then \
		echo "Error: infra/terraform.tfvars not found. Copy from terraform.tfvars.example and configure."; \
		exit 1; \
	fi
	cd infra && terraform init
	cd infra && terraform plan

# Deployment Helpers
upload-corpus: ## Upload corpus documents to S3 (requires BUCKET_NAME and CORPUS_DIR env vars)
	@if [ -z "$(BUCKET_NAME)" ] || [ -z "$(CORPUS_DIR)" ]; then \
		echo "Error: BUCKET_NAME and CORPUS_DIR environment variables required"; \
		echo "Usage: make upload-corpus BUCKET_NAME=my-bucket CORPUS_DIR=./corpus"; \
		exit 1; \
	fi
	./scripts/upload-corpus.sh $(BUCKET_NAME) $(CORPUS_DIR)

validate-deployment: ## Validate deployment by running health checks
	@echo "Validating deployment..."
	@if [ -z "$(API_URL)" ]; then \
		echo "Error: API_URL environment variable required"; \
		echo "Usage: make validate-deployment API_URL=https://api.example.com"; \
		exit 1; \
	fi
	./scripts/validate-deployment.sh $(API_URL)


# Full Deployment Workflow
deploy-all: package-lambda build-web deploy-infra ## Build and deploy everything
	@echo "Full deployment completed!"
	@echo "Next steps:"
	@echo "1. Upload corpus documents: make upload-corpus BUCKET_NAME=<bucket> CORPUS_DIR=<dir>"
	@echo "2. Validate deployment: make validate-deployment API_URL=<api-url>"

master-deploy: ## Run complete deployment with master script
	@echo "Running master deployment script..."
	./scripts/master-deploy.sh

master-deploy-fast: ## Run master deployment skipping tests
	@echo "Running fast master deployment (skipping tests)..."
	./scripts/master-deploy.sh --skip-tests

master-deploy-lambda-only: ## Deploy only Lambda function and test CORS
	@echo "Deploying Lambda function only..."
	./scripts/master-deploy.sh --skip-infra --skip-web --skip-tests

generate-web-env: ## Generate web .env file from Terraform outputs (requires deployed infrastructure)
	@echo "Generating web environment configuration..."
	@cd infra && \
	API_URL=$$(terraform output -raw api_gateway_url 2>/dev/null || echo "") && \
	WEB_URL=$$(terraform output -raw web_url 2>/dev/null || echo "") && \
	COGNITO_USER_POOL_ID=$$(terraform output -raw cognito_user_pool_id 2>/dev/null || echo "") && \
	COGNITO_CLIENT_ID=$$(terraform output -raw cognito_user_pool_client_id 2>/dev/null || echo "") && \
	COGNITO_DOMAIN=$$(terraform output -raw cognito_hosted_ui_url 2>/dev/null || echo "") && \
	cd .. && \
	if [ -n "$$API_URL" ] && [ -n "$$WEB_URL" ]; then \
		sed -e "s|<your-api-gateway-url>|$$API_URL|g" \
		    -e "s|<your-web-url>|$$WEB_URL|g" \
		    -e "s|<your-user-pool-id>|$$COGNITO_USER_POOL_ID|g" \
		    -e "s|<your-client-id>|$$COGNITO_CLIENT_ID|g" \
		    -e "s|<your-cognito-domain>|$${COGNITO_DOMAIN#https://}|g" \
		    apps/web/.env.example > apps/web/.env; \
		echo "✅ Web environment configuration generated"; \
	else \
		echo "❌ Could not get required values from Terraform outputs"; \
		exit 1; \
	fi

master-deploy-auto: ## Run master deployment with auto-approval
	@echo "Running master deployment script with auto-approval..."
	./scripts/master-deploy.sh --auto-approve

# Development Workflow
dev-setup: install ## Set up development environment
	@echo "Setting up development environment..."
	@if [ ! -f apps/api/.env ]; then \
		cp apps/api/.env.example apps/api/.env; \
		echo "Created apps/api/.env from example. Please configure it."; \
	fi
	@if [ ! -f apps/web/.env ]; then \
		cp apps/web/.env.example apps/web/.env; \
		echo "Created apps/web/.env from example. Please configure it."; \
	fi
	@if [ ! -f infra/terraform.tfvars ]; then \
		cp infra/terraform.tfvars.example infra/terraform.tfvars; \
		echo "Created infra/terraform.tfvars from example. Please configure it."; \
	fi
	@echo "Development environment setup complete!"

# CI/CD Helpers
ci-test: install lint test ## Run CI test suite
	@echo "CI test suite completed successfully"

ci-build: package-lambda build-web ## Build all artifacts for CI
	@echo "CI build completed successfully"

# Utility Commands
outputs: ## Show Terraform outputs
	@cd infra && terraform output

logs: ## Show recent Lambda logs (requires FUNCTION_NAME env var)
	@if [ -z "$(FUNCTION_NAME)" ]; then \
		echo "Error: FUNCTION_NAME environment variable required"; \
		echo "Usage: make logs FUNCTION_NAME=fedrag-api"; \
		exit 1; \
	fi
	aws logs tail /aws/lambda/$(FUNCTION_NAME) --follow

# Version and Info
version: ## Show version information
	@echo "FedRag Privacy RAG Assistant"
	@echo "Node.js: $$(node --version)"
	@echo "pnpm: $$(pnpm --version)"
	@echo "Terraform: $$(terraform version -json | jq -r '.terraform_version' 2>/dev/null || terraform version)"
	@echo "AWS CLI: $$(aws --version)"

# Documentation
docs: ## Generate and serve documentation
	@echo "Documentation available in README.md and .github/README.md"
	@echo "API documentation: apps/api/README.md"
	@echo "Web documentation: apps/web/README.md"
	@echo "Infrastructure documentation: infra/README.md"

# Security
security-scan: ## Run security scans locally
	@echo "Running security scans..."
	@if command -v trivy >/dev/null 2>&1; then \
		trivy fs . --severity HIGH,CRITICAL; \
	else \
		echo "Trivy not installed. Install with: brew install trivy"; \
	fi
	@if command -v tfsec >/dev/null 2>&1; then \
		cd infra && tfsec .; \
	else \
		echo "tfsec not installed. Install with: brew install tfsec"; \
	fi

# Backup and Restore
backup-state: ## Backup Terraform state (requires BACKUP_BUCKET env var)
	@if [ -z "$(BACKUP_BUCKET)" ]; then \
		echo "Error: BACKUP_BUCKET environment variable required"; \
		exit 1; \
	fi
	@echo "Backing up Terraform state..."
	cd infra && terraform state pull > terraform.tfstate.backup
	aws s3 cp infra/terraform.tfstate.backup s3://$(BACKUP_BUCKET)/terraform-state-backups/terraform.tfstate.$$(date +%Y%m%d-%H%M%S)
	@echo "State backed up to S3"