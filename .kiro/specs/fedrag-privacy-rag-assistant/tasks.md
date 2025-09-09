# Implementation Plan

- [x] 1. Set up project structure and core configuration
  - Create monorepo structure with apps/web, apps/api, infra directories
  - Configure pnpm workspaces with shared dependencies
  - Set up TypeScript configurations for both frontend and backend
  - Create environment variable templates and configuration files
  - _Requirements: 5.1, 6.1, 7.1, 9.3_

- [x] 2. Implement core TypeScript types and interfaces
  - Define shared types for API requests/responses in apps/api/src/types.ts
  - Create Bedrock Knowledge Base configuration interfaces
  - Define PII entity and masking result types
  - Create citation and guardrail action type definitions
  - _Requirements: 7.5, 4.4, 3.1_

- [ ] 3. Implement PII detection and masking functionality
  - Create apps/api/src/pii.ts with Comprehend DetectPiiEntities integration
  - Implement redactPII function with proper offset handling for overlapping spans
  - Add error handling for Comprehend service failures
  - Write unit tests for PII masking edge cases and overlapping entities
  - _Requirements: 3.1, 3.2, 3.5, 8.1_

- [ ] 4. Implement Bedrock Knowledge Base integration
  - Create apps/api/src/bedrock.ts with RetrieveAndGenerate API calls
  - Configure guardrail integration and Claude Sonnet model parameters
  - Implement citation processing and session management
  - Add error handling for Bedrock service failures and guardrail interventions
  - Write unit tests for knowledge base calls and guardrail behavior simulation
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 8.2, 8.3_

- [ ] 5. Create Lambda handler with request orchestration
  - Implement apps/api/src/index.ts main handler function
  - Orchestrate pre-PII → askKb → post-PII processing flow
  - Add structured logging with correlation IDs and performance metrics
  - Implement proper error handling and response formatting
  - Write integration tests for complete request flow
  - _Requirements: 7.4, 1.2, 1.3, 1.4, 7.5_

- [ ] 6. Set up Lambda build and packaging system
  - Configure esbuild/tsup for TypeScript compilation and bundling
  - Create package.json with proper dependencies and build scripts
  - Set up test configuration with Jest or Vitest
  - Create deployment scripts for Lambda zip creation
  - _Requirements: 7.1, 8.4, 9.4_

- [ ] 7. Implement Terraform infrastructure for Knowledge Base
  - Create infra/kb.tf with S3 corpus bucket configuration
  - Implement OpenSearch Serverless VECTOR collection using aws-ia module
  - Configure Bedrock Knowledge Base with Titan embeddings
  - Set up proper IAM roles and policies for service integration
  - _Requirements: 5.2, 5.3, 5.4, 4.2, 4.3_

- [ ] 8. Implement Terraform Bedrock Guardrails configuration
  - Create infra/guardrails.tf with aws_bedrock_guardrail resource
  - Configure harm categories with HIGH threshold settings
  - Set up PII entities with MASK action configuration
  - Define denied topics for compliance requirements
  - Add custom blocked input/output messaging
  - _Requirements: 5.4, 3.4, 1.5_

- [ ] 9. Create Terraform API infrastructure
  - Implement infra/api.tf with Lambda function configuration
  - Set up API Gateway HTTP API with CORS and JWT authorizer
  - Configure IAM roles with least-privilege permissions for Bedrock and Comprehend
  - Add environment variables for KB_ID, MODEL_ARN, GUARDRAIL_ID
  - _Requirements: 5.6, 2.3, 7.1, 7.2, 7.3_

- [ ] 10. Implement Terraform Cognito authentication
  - Create infra/auth.tf with Cognito user pool configuration
  - Set up app client for OAuth code flow without client secret
  - Configure Hosted UI domain and callback URLs
  - Add outputs for user pool ID and client ID
  - _Requirements: 5.6, 2.1, 2.2, 2.4_

- [ ] 11. Set up Terraform frontend hosting infrastructure
  - Create infra/hosting.tf with S3 static website configuration
  - Implement CloudFront distribution with Origin Access Control
  - Configure cache policies optimized for SPA delivery
  - Add outputs for web URL and CloudFront distribution
  - _Requirements: 5.8, 10.1, 10.2, 10.3, 10.5_

- [ ] 12. Create Terraform logging and monitoring
  - Implement infra/logging.tf with CloudWatch log groups
  - Set up log retention policies and structured logging configuration
  - Add CloudWatch metrics and alarms for error rates
  - Configure cost monitoring and budget alerts
  - _Requirements: 5.6, 7.5_

- [ ] 13. Implement React application structure and routing
  - Create apps/web/src/App.tsx with React Router configuration
  - Set up authentication state management and protected routes
  - Implement basic layout and navigation components
  - Configure Vite with TypeScript and Tailwind CSS
  - _Requirements: 6.1, 6.2, 1.1_

- [ ] 14. Implement Cognito authentication integration
  - Create apps/web/src/lib/auth/cognito.ts with OAuth code flow
  - Implement login redirect to Hosted UI with PKCE
  - Add handleCallback function for authorization code exchange
  - Implement logout with token cleanup and redirect
  - Add token validation and automatic refresh logic
  - _Requirements: 2.1, 2.2, 2.4, 6.1_

- [ ] 15. Create API client with JWT integration
  - Implement apps/web/src/lib/api/client.ts with fetch wrapper
  - Add automatic JWT header injection for authenticated requests
  - Implement error handling for 401/403 responses with re-authentication
  - Create specific chatQuery function for chat API endpoint
  - _Requirements: 2.3, 6.1_

- [ ] 16. Implement chat interface components
  - Create apps/web/src/pages/Chat.tsx with message history and input
  - Implement real-time message rendering with proper formatting
  - Add loading states and error handling for API calls
  - Create message submission and response handling logic
  - _Requirements: 1.1, 6.3, 6.4_

- [ ] 17. Create message and citation display components
  - Implement apps/web/src/components/Message.tsx for individual messages
  - Add PII redaction toggle functionality for demonstration
  - Create apps/web/src/components/Citations.tsx for citation panel
  - Implement S3 URI linking and excerpt display
  - Add guardrail intervention banner display
  - _Requirements: 1.3, 1.5, 6.4, 6.5_

- [ ] 18. Set up frontend build and development configuration
  - Configure apps/web/vite.config.ts with proper proxy settings
  - Set up environment variable handling with VITE_ prefix
  - Create .env.example with all required configuration variables
  - Add Tailwind CSS configuration and base styles
  - _Requirements: 6.1, 6.2, 6.5_

- [ ] 19. Create deployment scripts and CI/CD configuration
  - Implement scripts/upload-corpus.sh for S3 document upload
  - Create Makefile with package-lambda, deploy-infra, destroy-infra targets
  - Set up GitHub Actions for PR workflow with lint, test, terraform plan
  - Configure main branch workflow with manual approval for terraform apply
  - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [ ] 20. Write comprehensive unit tests for critical functions
  - Create tests/unit/pii.test.ts for PII masking edge cases
  - Implement tests/unit/kb.test.ts for knowledge base integration
  - Add tests/unit/guardrail.test.ts for guardrail intervention scenarios
  - Create tests for empty citations and "Insufficient basis" templates
  - Set up test coverage reporting and CI integration
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 21. Create documentation and setup instructions
  - Write comprehensive README.md with setup and deployment instructions
  - Document Bedrock model access enablement requirements
  - Create environment variable configuration guide
  - Add troubleshooting section for common deployment issues
  - Document corpus upload and knowledge base sync procedures
  - _Requirements: 5.5, 9.5_

- [ ] 22. Implement end-to-end integration and testing
  - Test complete authentication flow from Cognito to API access
  - Verify PII redaction functionality across the entire pipeline
  - Test knowledge base retrieval with actual document corpus
  - Validate guardrail interventions with denied topic queries
  - Confirm citation display and S3 URI linking functionality
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_