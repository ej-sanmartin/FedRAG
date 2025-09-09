# Requirements Document

## Introduction

FedRag is a privacy-first RAG (Retrieval-Augmented Generation) assistant built on AWS infrastructure that provides secure policy question-answering capabilities. The system combines React+Vite frontend with AWS Bedrock Knowledge Bases, implementing comprehensive PII protection through Bedrock Guardrails and Amazon Comprehend. The entire infrastructure is provisioned using Terraform for consistent, reproducible deployments.

## Requirements

### Requirement 1

**User Story:** As a policy researcher, I want to ask questions about policy documents through a secure web interface, so that I can get accurate answers with proper citations while ensuring my queries and the responses are protected from PII exposure.

#### Acceptance Criteria

1. WHEN a user accesses the web application THEN the system SHALL present a React-based chat interface with TypeScript support
2. WHEN a user submits a query THEN the system SHALL process it through PII detection and masking before sending to the knowledge base
3. WHEN the system generates a response THEN it SHALL include inline citations in bracket format [1], [2] with a citations panel
4. WHEN PII is detected in input or output THEN the system SHALL mask it with `<REDACTED:TYPE>` format
5. WHEN a guardrail intervention occurs THEN the system SHALL display a refusal banner to the user

### Requirement 2

**User Story:** As a security-conscious organization, I want all user authentication to go through AWS Cognito with JWT tokens, so that access to the RAG system is properly controlled and auditable.

#### Acceptance Criteria

1. WHEN a user attempts to access the chat interface THEN the system SHALL redirect unauthenticated users to Cognito Hosted UI
2. WHEN a user completes OAuth code flow THEN the system SHALL store the JWT token securely in localStorage
3. WHEN making API calls THEN the system SHALL include the Bearer JWT token in Authorization headers
4. WHEN a JWT token expires THEN the system SHALL redirect the user back to authentication
5. WHEN a user logs out THEN the system SHALL clear tokens and redirect to Cognito logout URL

### Requirement 3

**User Story:** As a compliance officer, I want the system to implement multiple layers of PII protection, so that sensitive information is never exposed in queries or responses.

#### Acceptance Criteria

1. WHEN processing user input THEN the system SHALL use Amazon Comprehend DetectPiiEntities to identify PII
2. WHEN PII entities are detected THEN the system SHALL mask them before sending to Bedrock
3. WHEN receiving responses from Bedrock THEN the system SHALL apply PII detection and masking again
4. WHEN Bedrock Guardrails detect policy violations THEN the system SHALL block the request and return appropriate messaging
5. WHEN overlapping PII spans are detected THEN the system SHALL handle masking correctly without corruption

### Requirement 4

**User Story:** As a knowledge worker, I want the RAG system to retrieve information from a curated knowledge base with vector search, so that I get relevant and accurate answers from trusted sources.

#### Acceptance Criteria

1. WHEN the system processes a query THEN it SHALL use Bedrock Knowledge Bases RetrieveAndGenerate API
2. WHEN performing retrieval THEN the system SHALL use amazon.titan-embed-text-v2:0 embeddings model
3. WHEN searching for context THEN the system SHALL retrieve up to 6 relevant documents from OpenSearch Serverless
4. WHEN generating responses THEN the system SHALL use Claude Sonnet model with temperature 0.2, topP 0.9, maxTokens 800
5. WHEN insufficient context is available THEN the system SHALL explicitly state this and list missing information sections

### Requirement 5

**User Story:** As a DevOps engineer, I want the entire infrastructure to be defined as code using Terraform, so that deployments are consistent, version-controlled, and reproducible across environments.

#### Acceptance Criteria

1. WHEN deploying infrastructure THEN the system SHALL provision all AWS resources using Terraform
2. WHEN creating vector storage THEN the system SHALL use OpenSearch Serverless VECTOR collection with proper encryption and access policies
3. WHEN setting up knowledge base THEN the system SHALL configure S3 corpus bucket with SSE-S3 encryption and public access blocks
4. WHEN configuring guardrails THEN the system SHALL set harm categories to HIGH threshold and PII masking to MASK action
5. WHEN provisioning API infrastructure THEN the system SHALL create Lambda with proper IAM permissions, API Gateway with JWT authorizer, and CloudWatch logging

### Requirement 6

**User Story:** As a frontend developer, I want a modern React application with TypeScript and Tailwind CSS, so that the user interface is maintainable, type-safe, and visually consistent.

#### Acceptance Criteria

1. WHEN building the frontend THEN the system SHALL use React 18 with Vite and TypeScript
2. WHEN styling components THEN the system SHALL use Tailwind CSS for consistent design
3. WHEN displaying chat messages THEN the system SHALL render answer paragraphs with proper formatting
4. WHEN showing citations THEN the system SHALL display them in a right rail with S3 URI links and excerpts
5. WHEN toggling redacted output THEN the system SHALL provide client-side demonstration of PII masking

### Requirement 7

**User Story:** As a backend developer, I want the Lambda function to be written in TypeScript with proper AWS SDK v3 integration, so that the API is type-safe and uses modern AWS client libraries.

#### Acceptance Criteria

1. WHEN implementing the Lambda handler THEN the system SHALL use Node.js 20 runtime with TypeScript
2. WHEN calling Bedrock services THEN the system SHALL use @aws-sdk/client-bedrock-agent-runtime for RetrieveAndGenerate
3. WHEN detecting PII THEN the system SHALL use @aws-sdk/client-comprehend for DetectPiiEntities
4. WHEN processing requests THEN the system SHALL follow the flow: pre-PII → askKb → post-PII → response
5. WHEN logging operations THEN the system SHALL use structured logging with latency and intervention metrics

### Requirement 8

**User Story:** As a quality assurance engineer, I want comprehensive unit tests for critical functions, so that PII masking, knowledge base calls, and guardrail functionality are properly validated.

#### Acceptance Criteria

1. WHEN testing PII functionality THEN the system SHALL include tests for overlapping spans and edge cases
2. WHEN testing knowledge base integration THEN the system SHALL verify proper API calls and response handling
3. WHEN testing guardrail behavior THEN the system SHALL simulate disallowed topics and verify intervention responses
4. WHEN testing empty citations THEN the system SHALL force "Insufficient basis" template scenarios
5. WHEN running CI/CD THEN the system SHALL execute all tests and require passing before deployment

### Requirement 9

**User Story:** As a deployment engineer, I want automated CI/CD pipelines with manual approval gates, so that code changes are properly tested and infrastructure changes are controlled.

#### Acceptance Criteria

1. WHEN creating pull requests THEN the system SHALL run lint, test, and terraform plan automatically
2. WHEN merging to main branch THEN the system SHALL require manual approval before terraform apply
3. WHEN building applications THEN the system SHALL use pnpm workspaces for monorepo management
4. WHEN packaging Lambda THEN the system SHALL use esbuild/tsup to create optimized bundles
5. WHEN deploying infrastructure THEN the system SHALL output API URLs, web URLs, and resource identifiers

### Requirement 10

**User Story:** As a system administrator, I want proper hosting and CDN setup for the frontend application, so that users have fast, reliable access to the web interface.

#### Acceptance Criteria

1. WHEN hosting the frontend THEN the system SHALL use S3 static website hosting with CloudFront distribution
2. WHEN configuring CDN THEN the system SHALL use Origin Access Control (OAC) for secure S3 access
3. WHEN setting cache policies THEN the system SHALL optimize for static asset delivery
4. WHEN providing URLs THEN the system SHALL output both API and web URLs from Terraform
5. WHEN serving content THEN the system SHALL support proper CORS configuration for API access