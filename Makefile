.PHONY: install dev build test lint clean package-lambda deploy-infra destroy-infra

# Development commands
install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

type-check:
	pnpm type-check

clean:
	rm -rf node_modules apps/*/node_modules apps/*/dist infra/.terraform

# Lambda packaging
package-lambda:
	@echo "📦 Packaging Lambda function..."
	./scripts/package-lambda.sh

package-lambda-with-layer:
	@echo "📦 Packaging Lambda function with layer..."
	./scripts/package-lambda.sh --with-layer

validate-package:
	@echo "🔍 Validating deployment package..."
	./scripts/validate-deployment.sh

# Infrastructure commands
deploy-infra:
	cd infra && terraform init
	cd infra && terraform plan
	cd infra && terraform apply

destroy-infra:
	cd infra && terraform destroy

# Utility commands
setup-env:
	cp .env.example .env
	cp apps/web/.env.example apps/web/.env
	cp apps/api/.env.example apps/api/.env
	@echo "Please configure your environment variables in the .env files"