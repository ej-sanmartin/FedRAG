# FedRag - Privacy-First RAG Assistant

![Preview UI of Deployed FedRAG](assets/fedrag-ui.png "Preview UI of Deployed FedRAG")

A privacy-first RAG (Retrieval-Augmented Generation) assistant built on AWS infrastructure that provides secure policy question-answering capabilities. The system combines React+Vite frontend with AWS Bedrock Knowledge Bases, implementing comprehensive PII protection through Bedrock Guardrails and Amazon Comprehend.

## 🏗️ Architecture Overview

The system implements a serverless microservices pattern with multi-layer security:

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js 20 Lambda + TypeScript + AWS SDK v3
- **AI/ML**: AWS Bedrock Knowledge Bases + Claude Sonnet + Titan Embeddings
- **Security**: Bedrock Guardrails + Amazon Comprehend PII Detection
- **Infrastructure**: Terraform + AWS (Cognito, API Gateway, OpenSearch Serverless, S3)

### Compliance-Aware Guardrail Routing

Incoming questions are routed between two Bedrock guardrail configurations. The handler first pulls lightweight context from the knowledge base, then uses a lexical compliance heuristic combined with a Comprehend scan to determine whether the dedicated compliance rail can be applied safely.【F:apps/api/src/safety/guardrailRouting.ts†L1-L151】【F:apps/api/src/index.ts†L339-L456】 Prompts that look like compliance guidance and do not contain medium/high risk entities are answered with the compliance guardrail to preserve helpfulness, while any detected sensitive entities or detector failures automatically fall back to the default guardrail and are logged for follow-up.【F:apps/api/src/safety/guardrailRouting.ts†L104-L151】【F:apps/api/src/index.ts†L415-L456】

### Knowledge Base Resiliency & Degraded Answers

The Lambda wraps Bedrock with layered resiliency. It keeps both context snippets and generated answers in an in-memory LRU cache that is sized and aged via environment knobs, and it retries Bedrock calls with configurable exponential backoff before surfacing throttling back to the client.【F:apps/api/src/services/knowledgeBase.ts†L163-L347】【F:apps/api/src/bedrock.ts†L90-L160】 When Bedrock or the knowledge base still throttle after the retries, the handler returns an explicitly marked degraded, unsourced response so the user gets immediate guidance while telemetry shows that the answer lacked citations.【F:apps/api/src/services/knowledgeBase.ts†L299-L347】【F:apps/api/src/index.ts†L339-L518】

### Telemetry Expectations

Every invocation emits structured telemetry that captures the chosen guardrail, compliance routing decisions, knowledge base degradation flags, retry counts, latency buckets, and a rolling twelve-week aggregate for each guardrail configuration.【F:apps/api/src/index.ts†L703-L735】【F:apps/api/src/telemetry/log.ts†L1-L150】 Operations teams can rely on these CloudWatch logs to monitor compliance routing effectiveness, guardrail interventions, and degradation rates over time without needing to join across disparate log streams.【F:apps/api/src/telemetry/log.ts†L44-L154】

## 📁 Project Structure

```
fedrag-privacy-rag-assistant/
├── apps/
│   ├── web/              # React frontend application
│   │   ├── src/
│   │   │   ├── components/   # React components
│   │   │   ├── pages/        # Page components
│   │   │   ├── lib/          # Utilities and API clients
│   │   │   └── contexts/     # React contexts
│   │   └── package.json
│   └── api/              # Lambda backend API
│       ├── src/
│       │   ├── index.ts      # Main Lambda handler
│       │   ├── bedrock.ts    # Bedrock integration
│       │   ├── pii.ts        # PII detection/masking
│       │   └── types.ts      # TypeScript definitions
│       └── package.json
├── infra/                # Terraform infrastructure
│   ├── kb.tf             # Knowledge Base infrastructure
│   ├── guardrails.tf     # Bedrock Guardrails
│   ├── api.tf            # API Gateway + Lambda
│   ├── auth.tf           # Cognito authentication
│   ├── hosting.tf        # S3 + CloudFront
│   └── variables.tf      # Terraform variables
├── scripts/              # Deployment and utility scripts
├── .github/              # CI/CD workflows
└── .kiro/                # Kiro specifications
```

## 🚀 Quick Start

### Prerequisites

Before you begin, ensure you have:

- **Node.js 20+** and **pnpm 8+** installed
- **AWS CLI** configured with appropriate credentials
- **Terraform 1.5+** installed
- **AWS Bedrock model access** enabled (see [Bedrock Model Access](#bedrock-model-access))

### 1. Clone and Install

```bash
git clone <repository-url>
cd fedrag-privacy-rag-assistant
pnpm install
```

### 2. Environment Configuration

Set up your environment variables:

```bash
# Copy environment templates
make dev-setup

# Or manually:
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

### 3. Configure Environment Variables

Edit the configuration files with your specific values:

#### `infra/terraform.tfvars`
```hcl
project_name = "fedrag"
environment  = "dev"
aws_region   = "us-east-1"

# Optional: Custom tags
common_tags = {
  Project     = "FedRag"
  Owner       = "your-team"
  Environment = "development"
}
```

#### `apps/web/.env`
```bash
# These will be populated after infrastructure deployment
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com
VITE_API_URL=https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com

# Development settings
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback
VITE_COGNITO_LOGOUT_URI=http://localhost:5173
```

### 4. Deploy Infrastructure

```bash
# Deploy all infrastructure
make deploy-infra

# Or step by step:
cd infra
terraform init
terraform plan
terraform apply
```

After deployment, Terraform will output the required configuration values. Update your environment files with these values.

### 5. Upload Corpus Documents

```bash
# Upload your document corpus
make upload-corpus BUCKET_NAME=<corpus-bucket-name> CORPUS_DIR=./your-corpus-directory

# Wait for Knowledge Base sync (check AWS Console)
```

### 6. Start Development

```bash
# Start both frontend and API in development mode
pnpm dev

# Or individually:
cd apps/web && pnpm dev    # Frontend on http://localhost:5173
cd apps/api && pnpm dev    # API development server
```

## 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `make help` | Show all available commands |
| `make dev-setup` | Set up development environment |
| `make install` | Install all dependencies |
| `make test` | Run all tests |
| `make lint` | Run linting on all projects |
| `make build-web` | Build web application |
| `make package-lambda` | Package Lambda for deployment |
| `make deploy-infra` | Deploy infrastructure with Terraform |
| `make upload-corpus` | Upload documents to S3 |
| `make validate-deployment` | Validate deployment health |

## 🔐 Bedrock Model Access

### Required Models

Before deploying, you must enable access to these Bedrock models in your AWS account:

1. **amazon.titan-embed-text-v2:0** (for embeddings)
2. **anthropic.claude-3-5-sonnet-20240620-v1:0** (for generation)

### Enabling Model Access

1. **AWS Console Method**:
   - Go to AWS Bedrock Console → Model access
   - Select the required models
   - Submit access request
   - Wait for approval (usually immediate for most models)

2. **AWS CLI Method**:
   ```bash
   # Check current model access
   aws bedrock list-foundation-models --region us-east-1

   # Request access (if needed)
   aws bedrock put-model-invocation-logging-configuration \
     --region us-east-1 \
     --logging-config '{
       "cloudWatchConfig": {
         "logGroupName": "/aws/bedrock/modelinvocations",
         "roleArn": "arn:aws:iam::ACCOUNT:role/service-role/AmazonBedrockExecutionRoleForKnowledgeBase"
       }
     }'
   ```

3. **Terraform Verification**:
   ```bash
   # After enabling access, verify with:
   cd infra
   terraform plan
   # Should show no errors related to model access
   ```

### Model Access Troubleshooting

**Error: "Could not access model"**
- Verify model access in Bedrock Console
- Check AWS region (must be us-east-1)
- Ensure IAM permissions include `bedrock:InvokeModel`

**Error: "Model not found"**
- Confirm exact model ARN in terraform.tfvars
- Check model availability in your region
- Verify model name spelling

## 📋 Environment Variables Guide

### Frontend Variables (`apps/web/.env`)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID | `us-east-1_xxxxxxxxx` | ✅ |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID | `xxxxxxxxxxxxxxxxxxxxxxxxxx` | ✅ |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI domain | `fedrag.auth.us-east-1.amazoncognito.com` | ✅ |
| `VITE_API_URL` | API Gateway URL | `https://api.example.com` | ✅ |
| `VITE_COGNITO_REDIRECT_URI` | OAuth callback URL | `http://localhost:5173/callback` | ✅ |
| `VITE_COGNITO_LOGOUT_URI` | Logout redirect URL | `http://localhost:5173` | ✅ |
| `VITE_ENABLE_PII_TOGGLE` | Enable PII redaction toggle | `true` | ❌ |
| `VITE_MAX_MESSAGE_LENGTH` | Max query length | `2000` | ❌ |

### Backend Variables (`apps/api/.env`)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `KB_ID` | Bedrock Knowledge Base ID | `XXXXXXXXXX` | ✅ |
| `MODEL_ARN` | Claude model ARN | `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0` | ✅ |
| `GR_DEFAULT_ID` | Base guardrail used for all traffic and as the fallback when compliance checks fail | `gr-xxxxxxxx` | ✅ |
| `GR_DEFAULT_VERSION` | Version of the base guardrail configuration | `1` | ✅ |
| `GR_COMPLIANCE_ID` | Secondary guardrail for compliance guidance; used only when routing heuristics allow it | `gr-yyyyyyyy` | ✅ (recommended) |
| `GR_COMPLIANCE_VERSION` | Version of the compliance guardrail | `1` | ✅ (recommended) |
| `CACHE_MAX_ENTRIES` (`KB_CACHE_SIZE`) | LRU cache capacity for stored context and answers. Set to `0` to disable caching. | `64` | ❌ |
| `CACHE_TTL_SECONDS` (`KB_CACHE_TTL_MS`) | Cache retention window. Provide seconds (or set `KB_CACHE_TTL_MS` directly in milliseconds). | `120` | ❌ |
| `KB_CACHE_ENABLED` | Explicit switch for the knowledge base cache layer. | `true` | ❌ |
| `KB_MAX_RETRIES` | Max retry attempts against Bedrock before returning a degraded response. | `4` | ❌ |
| `KB_BACKOFF_BASE_MS` | Initial delay for exponential backoff during throttling. | `200` | ❌ |
| `KB_BACKOFF_MAX_MS` | Maximum backoff delay applied across retries. | `2000` | ❌ |
| `NODE_ENV` | Environment | `development` or `production` | ❌ |

> ℹ️ **Note:** AWS Lambda automatically provides the `AWS_REGION` environment variable at runtime, so no manual configuration is required.
>
> 💡 **Deployment tip:** The handler reads the `KB_*` names at runtime. If your secret management prefers the friendlier `CACHE_MAX_ENTRIES` or `CACHE_TTL_SECONDS` keys, map them into the Lambda's `KB_CACHE_SIZE` and `KB_CACHE_TTL_MS` values during deployment so the cache receives the intended settings.【F:apps/api/src/services/knowledgeBase.ts†L163-L223】

### Infrastructure Variables (`infra/terraform.tfvars`)

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `project_name` | Project name prefix | `fedrag` | ❌ |
| `environment` | Environment name | `dev` | ❌ |
| `aws_region` | AWS region | `us-east-1` | ❌ |
| `common_tags` | Resource tags | `{}` | ❌ |

## 🚀 Deployment Guide

> **Full workflow:** `make deploy-infra` → `make package-lambda` → `make master-deploy` → `./scripts/upload-corpus.sh <bucket> <dir>` → `make validate-deployment API_URL=<api-url>`

### Resiliency Deployment Considerations

- **Cap Lambda concurrency**: Set a reserved concurrency (for example via `aws lambda put-function-concurrency --function-name fedrag-api --reserved-concurrent-executions 10`) that matches your Bedrock guardrail throughput so the new degraded-answer path only triggers under genuine Bedrock throttling rather than local saturation.【F:apps/api/src/services/knowledgeBase.ts†L299-L347】【F:apps/api/src/index.ts†L339-L518】 Adjust the cap as Bedrock quotas change.
- **Introduce burst queueing**: For traffic spikes that would otherwise overflow the reserved concurrency, front the API with an SQS or EventBridge queue so requests wait instead of immediately invoking the degraded response path. Ensure the queue redrives failed or expired messages so compliance questions are eventually retried with full knowledge base context.【F:apps/api/src/services/knowledgeBase.ts†L299-L347】
- **Monitor degradation telemetry**: Watch the `kb_degraded` counters in the structured telemetry stream to validate that concurrency and queue settings are absorbing bursts as expected.【F:apps/api/src/index.ts†L703-L735】【F:apps/api/src/telemetry/log.ts†L44-L150】

### Step 1: Deploy Infrastructure

Provision the AWS resources (Cognito, API Gateway, Lambda, S3, etc.) before shipping any application code.

```bash
# Deploy all Terraform-managed infrastructure
make deploy-infra

# Review and approve the Terraform plan when prompted
```

After Terraform completes, capture the outputs (API Gateway URL, web distribution URL, Cognito IDs, S3 bucket names) and update your `.env` files as needed.

### Step 2: Package the Lambda API

Package the backend Lambda so it is ready to upload. This command installs dependencies, builds the handler, and creates `apps/api/lambda-deployment.zip`.

```bash
make test              # Optional: run the full test suite first
make package-lambda    # Generates the Lambda deployment bundle
```

You can inspect the resulting ZIP at `apps/api/lambda-deployment.zip` if you need to verify contents before deploying.

### Step 3: Orchestrate Deployment with the Master Script

Run the one-stop deployment pipeline once your infrastructure and package are ready. The master script installs dependencies, (re)packages the Lambda, deploys infrastructure, uploads the Lambda bundle, optionally builds and syncs the web app, and runs a CORS smoke test.

```bash
make master-deploy
```

Additional options:

- `make master-deploy-fast` – Skip the pnpm test run.
- `make master-deploy-lambda-only` – Deploy just the Lambda function and run the CORS smoke test.
- `./scripts/master-deploy.sh --skip-tests --skip-infra --skip-web` – Call the script directly with fine-grained flags.

The command surfaces final URLs and next steps, making it ideal for production rollouts.

### Step 4: Upload Knowledge Base Corpus

Once infrastructure is in place, push your document set to the Bedrock Knowledge Base bucket. You can continue using `make upload-corpus` or call the helper script directly.

```bash
# Using the helper script (after deployment)
./scripts/upload-corpus.sh \
  "$(cd infra && terraform output -raw corpus_bucket_name)" \
  ./corpus

# Equivalent Make target
make upload-corpus \
  BUCKET_NAME="$(cd infra && terraform output -raw corpus_bucket_name)" \
  CORPUS_DIR=./corpus
```

The script validates your AWS credentials, uploads supported file types, and reminds you to monitor the Knowledge Base sync job.

### Step 5: Post-Deployment Validation & CORS Checks

Verify that the deployed API accepts requests from the web origin and that the health checks succeed. The CORS test script exercises OPTIONS/GET/POST flows, while the validation Make target runs the broader post-deploy script.

```bash
# Check CORS headers and auth behaviour
./scripts/test-cors.sh \
  "$(cd infra && terraform output -raw api_gateway_url)" \
  "$(cd infra && terraform output -raw web_url)"

# Run end-to-end smoke tests (health, configuration, etc.)
make validate-deployment \
  API_URL="$(cd infra && terraform output -raw api_gateway_url)"
```

If any checks fail, review the script output for troubleshooting tips and inspect CloudWatch logs for deeper diagnostics.

### CI/CD Deployment

The project includes GitHub Actions workflows:

- **Pull Requests**: Automatic testing and Terraform planning
- **Main Branch**: Manual approval required for production deployment

Required GitHub Secrets:
```
AWS_ROLE_ARN=arn:aws:iam::ACCOUNT:role/GitHubActionsRole
TF_VAR_PROJECT_NAME=fedrag
TF_VAR_ENVIRONMENT=production
TF_VAR_COGNITO_DOMAIN_PREFIX=fedrag-prod
TF_VAR_WEB_CALLBACK_URLS=["https://your-domain.com/callback"]
TF_VAR_WEB_LOGOUT_URLS=["https://your-domain.com/login"]
```

> ℹ️ **Region configuration:** The workflows resolve the AWS region from your `infra/terraform.tfvars` settings (defaulting to `us-east-1`) or an override provided via workflow inputs—no separate secret is required.

## 📚 Corpus Upload and Knowledge Base Sync

### Supported Document Formats

- **Text files**: `.txt`, `.md`
- **PDF files**: `.pdf`
- **Word documents**: `.docx`

### Upload Process

1. **Prepare Documents**:
   ```bash
   mkdir corpus
   # Add your documents to the corpus directory
   ```

2. **Upload to S3**:
   ```bash
   # Get bucket name from Terraform outputs
   cd infra && terraform output corpus_bucket_name

   # Upload documents
   make upload-corpus BUCKET_NAME=<bucket-name> CORPUS_DIR=./corpus
   ```

3. **Trigger Knowledge Base Sync**:
   ```bash
   # Option 1: AWS Console
   # Go to Bedrock → Knowledge Bases → Your KB → Data sources → Sync

   # Option 2: AWS CLI
   aws bedrock-agent start-ingestion-job \
     --knowledge-base-id <kb-id> \
     --data-source-id <data-source-id> \
     --region us-east-1
   ```

4. **Monitor Sync Progress**:
   - Check AWS Bedrock Console
   - Monitor CloudWatch logs
   - Sync typically takes 5-15 minutes depending on corpus size

### Corpus Management Best Practices

- **Document Structure**: Use clear headings and sections
- **File Naming**: Use descriptive, consistent naming
- **Content Quality**: Ensure documents are well-formatted and readable
- **Size Limits**: Individual files should be under 50MB
- **Update Process**: Re-upload changed documents and trigger sync

## 🔧 Troubleshooting

### Common Deployment Issues

#### 1. Terraform Errors

**Error: "Bedrock model access denied"**
```bash
# Solution: Enable model access in Bedrock Console
aws bedrock list-foundation-models --region us-east-1
# Then enable required models in AWS Console
```

**Error: "Resource already exists"**
```bash
# Solution: Import existing resources or use different names
terraform import aws_s3_bucket.example bucket-name
```

**Error: "Insufficient permissions"**
```bash
# Solution: Check IAM permissions
aws sts get-caller-identity
aws iam get-user
# Ensure user has PowerUser or equivalent permissions
```

#### 2. Lambda Deployment Issues

**Error: "Package too large"**
```bash
# Solution: Check package size and optimize
ls -lh apps/api/lambda-deployment.zip
# Should be under 50MB for direct upload
```

**Error: "Runtime error"**
```bash
# Solution: Check CloudWatch logs
aws logs tail /aws/lambda/fedrag-api --follow
```

#### 3. Frontend Issues

**Error: "Cognito authentication failed"**
- Verify Cognito configuration in `.env`
- Check callback URLs in Cognito Console
- Ensure CORS is properly configured

**Error: "API calls failing"**
- Verify API Gateway URL
- Check JWT token validity
- Confirm CORS headers

#### 4. Knowledge Base Issues

**Error: "No search results"**
- Verify corpus upload completed
- Check Knowledge Base sync status
- Ensure documents are in supported formats

**Error: "Embedding failures"**
- Verify Titan model access
- Check document content quality
- Monitor CloudWatch logs for errors

### Performance Issues

#### Slow API Responses
1. **Check Lambda cold starts**:
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/fedrag-api \
     --filter-pattern "INIT_START"
   ```

2. **Monitor Bedrock latency**:
   - Check CloudWatch metrics
   - Consider provisioned throughput for high usage

3. **Optimize Knowledge Base**:
   - Review retrieval configuration
   - Adjust number of results (default: 6)

#### High Costs
1. **Monitor Bedrock usage**:
   ```bash
   aws ce get-cost-and-usage \
     --time-period Start=2024-01-01,End=2024-01-31 \
     --granularity MONTHLY \
     --metrics BlendedCost \
     --group-by Type=DIMENSION,Key=SERVICE
   ```

2. **Optimize Lambda**:
   - Review memory allocation
   - Monitor execution duration
   - Consider reserved concurrency

### Security Issues

#### PII Detection Problems
- Verify Comprehend service availability
- Check IAM permissions for Comprehend
- Review PII masking logic in logs

#### Guardrail Interventions
- Check guardrail configuration
- Review denied topics list
- Monitor intervention rates in CloudWatch
- Compliance-focused prompts that mention personal information but contain no detected PII will automatically retry once without the guardrail configuration after logging the bypass in CloudWatch. This ensures policy questions (e.g., "How should we handle customer PII?") receive answers while true PII requests remain blocked.

### Getting Help

1. **Check Logs**:
   ```bash
   # Lambda logs
   make logs FUNCTION_NAME=fedrag-api

   # CloudWatch Insights
   aws logs start-query \
     --log-group-name /aws/lambda/fedrag-api \
     --start-time $(date -d '1 hour ago' +%s) \
     --end-time $(date +%s) \
     --query-string 'fields @timestamp, @message | filter @message like /ERROR/'
   ```

2. **Validate Configuration**:
   ```bash
   make validate-deployment API_URL=<your-api-url>
   ```

3. **Check AWS Service Health**:
   - AWS Service Health Dashboard
   - Bedrock service status
   - Regional service availability

## 🧪 Testing

### Running Tests

```bash
# Run all tests
make test

# Run specific test suites
cd apps/api && pnpm test
cd apps/web && pnpm test

# Run with coverage
cd apps/api && pnpm test:coverage
```

### Test Structure

- **Unit Tests**: `apps/api/src/*.test.ts`
- **Integration Tests**: `apps/api/tests/unit/`
- **End-to-End Tests**: Manual testing procedures

### Key Test Areas

1. **PII Detection and Masking**
2. **Bedrock Knowledge Base Integration**
3. **Guardrail Functionality**
4. **Authentication Flow**
5. **API Error Handling**

## 📊 Monitoring and Observability

### CloudWatch Metrics

Key metrics to monitor:
- Lambda execution duration and errors
- Bedrock API call latency and costs
- Cognito authentication success rates
- API Gateway request counts and errors

### Structured Logging

The application uses structured JSON logging:
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "level": "INFO",
  "correlationId": "abc-123",
  "message": "PII detection completed",
  "entitiesFound": 2,
  "processingTimeMs": 150
}
```

### Alerting

Set up CloudWatch alarms for:
- High error rates (>5%)
- Slow response times (>5s)
- Guardrail intervention spikes
- Cost thresholds

## 🔒 Security Considerations

### Multi-Layer PII Protection

1. **Pre-processing**: Comprehend PII detection before Bedrock
2. **Guardrails**: Bedrock native PII masking during generation
3. **Post-processing**: Additional Comprehend scan of responses
4. **Client-side**: Optional redaction display toggle

### Authentication Security

- JWT tokens with automatic refresh
- Secure token storage (localStorage with expiration)
- CORS configuration for API protection
- Cognito Hosted UI for secure authentication

### Infrastructure Security

- Encryption at rest and in transit
- IAM least-privilege policies
- VPC endpoints (future enhancement)
- Security group restrictions

## 📈 Performance Optimization

### Lambda Optimization

- Memory allocation: 512MB (adjustable)
- Timeout: 30 seconds
- Provisioned concurrency for production
- Layer usage for common dependencies

### Frontend Optimization

- Code splitting with Vite
- Lazy loading of components
- Optimized bundle size
- CDN delivery via CloudFront

### Cost Optimization

- Serverless architecture (pay-per-use)
- S3 Intelligent Tiering
- OpenSearch Serverless auto-scaling
- Bedrock on-demand pricing

## 🤝 Contributing

1. **Development Setup**:
   ```bash
   make dev-setup
   ```

2. **Code Standards**:
   - TypeScript strict mode
   - ESLint configuration
   - Prettier formatting
   - Conventional commits

3. **Testing Requirements**:
   - Unit tests for new features
   - Integration tests for API changes
   - Manual testing for UI changes

4. **Pull Request Process**:
   - Create feature branch
   - Run tests and linting
   - Submit PR with description
   - Address review feedback

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For issues and questions:

1. **Check Documentation**: Review this README and inline code comments
2. **Search Issues**: Look for similar problems in the issue tracker
3. **Check Logs**: Review CloudWatch logs for error details
4. **Contact Team**: Reach out to the development team

---

**Next Steps After Setup:**
1. ✅ Deploy infrastructure
2. ✅ Upload corpus documents
3. ✅ Test authentication flow
4. ✅ Verify PII protection
5. ✅ Monitor performance metrics