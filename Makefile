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
	cd apps/api && pnpm build
	cd apps/api && zip -r lambda-deployment.zip dist/ node_modules/

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