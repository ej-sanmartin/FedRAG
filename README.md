# FedRag - Privacy-First RAG Assistant

A privacy-first RAG (Retrieval-Augmented Generation) assistant built on AWS infrastructure that provides secure policy question-answering capabilities.

## Project Structure

```
fedrag-privacy-rag-assistant/
├── apps/
│   ├── web/          # React frontend application
│   └── api/          # Lambda backend API
├── infra/            # Terraform infrastructure code
├── .kiro/            # Kiro specifications and configuration
└── package.json      # Root workspace configuration
```

## Prerequisites

- Node.js 20+
- pnpm 8+
- AWS CLI configured
- Terraform (for infrastructure deployment)

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env
   cp apps/web/.env.example apps/web/.env
   cp apps/api/.env.example apps/api/.env
   ```

3. Configure your environment variables in the `.env` files

4. Start development servers:
   ```bash
   pnpm dev
   ```

## Development Commands

- `pnpm dev` - Start all development servers
- `pnpm build` - Build all applications
- `pnpm test` - Run all tests
- `pnpm lint` - Lint all code
- `pnpm type-check` - Run TypeScript type checking

## Architecture

The system implements a serverless microservices pattern with:

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js Lambda + TypeScript
- **Infrastructure**: Terraform + AWS (Bedrock, Cognito, API Gateway, etc.)
- **Security**: Multi-layer PII protection with Bedrock Guardrails and Amazon Comprehend

## License

Private - All rights reserved