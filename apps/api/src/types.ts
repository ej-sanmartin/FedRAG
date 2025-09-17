/**
 * Core TypeScript types and interfaces for FedRag Privacy RAG Assistant
 * 
 * This file defines shared types for API requests/responses, Bedrock Knowledge Base
 * configuration, PII entity handling, and citation/guardrail action types.
 */

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Chat API request payload
 */
export interface ChatRequest {
  query: string;
  sessionId?: string;
}

/**
 * Chat API response payload
 */
export interface ChatResponse {
  answer: string;
  citations: Citation[];
  guardrailAction?: GuardrailAction;
  sessionId: string;
  redactedQuery?: string;
  redactedAnswer?: string;
}

// ============================================================================
// Bedrock Knowledge Base Configuration Types
// ============================================================================

/**
 * Complete Knowledge Base configuration interface
 */
export interface KnowledgeBaseConfig {
  knowledgeBaseId: string;
  modelArn: string;
  generationConfiguration: GenerationConfiguration;
  retrievalConfiguration: RetrievalConfiguration;
}

/**
 * Generation configuration for Bedrock Knowledge Base
 */
export interface GenerationConfiguration {
  guardrailConfiguration: GuardrailConfiguration;
  inferenceConfig: InferenceConfig;
  promptTemplate: PromptTemplate;
}

/**
 * Guardrail configuration for content filtering
 */
export interface GuardrailConfiguration {
  guardrailId: string;
  guardrailVersion: string;
}

/**
 * Inference configuration for model parameters
 */
export interface InferenceConfig {
  textInferenceConfig: TextInferenceConfig;
}

/**
 * Text inference configuration with model parameters
 */
export interface TextInferenceConfig {
  temperature: number;
  topP: number;
  maxTokens: number;
}

/**
 * Prompt template configuration
 */
export interface PromptTemplate {
  textPromptTemplate: string;
}

/**
 * Retrieval configuration for vector search
 */
export interface RetrievalConfiguration {
  vectorSearchConfiguration: VectorSearchConfiguration;
}

/**
 * Vector search configuration parameters
 */
export interface VectorSearchConfiguration {
  numberOfResults: number;
}

// ============================================================================
// PII Entity and Masking Types
// ============================================================================

/**
 * PII entity detected by Amazon Comprehend
 */
export interface PiiEntity {
  Type: string;
  Score: number;
  BeginOffset: number;
  EndOffset: number;
}

/**
 * Result of PII masking operation
 */
export interface PiiMaskingResult {
  originalText: string;
  maskedText: string;
  entitiesFound: PiiEntity[];
}

/**
 * PII detection request parameters
 */
export interface PiiDetectionRequest {
  text: string;
  languageCode?: string;
}

/**
 * PII detection response from Comprehend
 */
export interface PiiDetectionResponse {
  Entities: PiiEntity[];
}

// ============================================================================
// Citation and Guardrail Action Types
// ============================================================================

/**
 * Citation structure from Bedrock Knowledge Base
 */
export interface Citation {
  generatedResponsePart: GeneratedResponsePart;
  retrievedReferences: RetrievedReference[];
}

/**
 * Generated response part with text and span information
 */
export interface GeneratedResponsePart {
  textResponsePart: TextResponsePart;
}

/**
 * Text response part with content and span
 */
export interface TextResponsePart {
  text: string;
  span: TextSpan;
}

/**
 * Text span indicating start and end positions
 */
export interface TextSpan {
  start: number;
  end: number;
}

/**
 * Retrieved reference from knowledge base
 */
export interface RetrievedReference {
  content: ReferenceContent;
  location?: ReferenceLocation;
  metadata?: Record<string, any>;
}

/**
 * Content of a retrieved reference
 */
export interface ReferenceContent {
  text: string;
}

/**
 * Location information for a reference
 */
export interface ReferenceLocation {
  s3Location?: S3Location;
}

/**
 * S3 location information
 */
export interface S3Location {
  uri: string;
}

/**
 * Guardrail action types
 */
export type GuardrailAction = 'INTERVENED' | 'NONE';

/**
 * Guardrail intervention details
 */
export interface GuardrailIntervention {
  action: GuardrailAction;
  message?: string;
  reason?: string;
}

// ============================================================================
// Bedrock Service Response Types
// ============================================================================

/**
 * Bedrock RetrieveAndGenerate API response
 */
export interface BedrockRetrieveAndGenerateResponse {
  output: BedrockOutput;
  citations: Citation[];
  guardrailAction?: GuardrailAction;
  sessionId: string;
}

/**
 * Bedrock output structure
 */
export interface BedrockOutput {
  text: string;
}

/**
 * Bedrock RetrieveAndGenerate API request
 */
export interface BedrockRetrieveAndGenerateRequest {
  input: BedrockInput;
  retrieveAndGenerateConfiguration: RetrieveAndGenerateConfiguration;
  sessionConfiguration?: SessionConfiguration;
  sessionId?: string;
}

/**
 * Bedrock input structure
 */
export interface BedrockInput {
  text: string;
}

/**
 * Retrieve and generate configuration
 */
export interface RetrieveAndGenerateConfiguration {
  type: 'KNOWLEDGE_BASE';
  knowledgeBaseConfiguration: KnowledgeBaseConfiguration;
}

/**
 * Knowledge base configuration for Bedrock request
 */
export interface KnowledgeBaseConfiguration {
  knowledgeBaseId: string;
  modelArn: string;
  generationConfiguration?: GenerationConfiguration;
  retrievalConfiguration?: RetrievalConfiguration;
}

/**
 * Session configuration for conversation continuity
 */
export interface SessionConfiguration {
  kmsKeyArn?: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * API error response structure
 */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  correlationId?: string;
}

/**
 * AWS service error details
 */
export interface AwsServiceError {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  retryable?: boolean;
  details?: string;
  retries?: number;
}

// ============================================================================
// Logging Types
// ============================================================================

/**
 * Structured log entry for correlation and metrics
 */
export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  correlationId: string;
  operation?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

/**
 * Performance metrics for operations
 */
export interface PerformanceMetrics {
  piiDetectionLatency?: number;
  knowledgeBaseLatency?: number;
  contextRetrievalLatency?: number;
  guardrailSelectionLatency?: number;
  totalLatency: number;
  guardrailInterventions: number;
  entitiesDetected: number;
  knowledgeBaseRetries?: number;
  knowledgeBaseCacheHit?: boolean;
  knowledgeBaseDegraded?: boolean;
  contextRetryCount?: number;
  contextCacheHit?: boolean;
  contextDegraded?: boolean;
  blockedByGuardrail?: boolean;
  guardrailId?: string;
  usedComplianceGuardrail?: boolean;
  guardrailTopics?: string[];
}