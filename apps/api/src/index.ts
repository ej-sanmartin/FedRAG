/**
 * FedRag Privacy RAG Assistant - Lambda Handler
 * 
 * Main Lambda handler that orchestrates the complete request flow:
 * 1. Pre-PII detection and masking of user input
 * 2. Knowledge base query with masked input
 * 3. Post-PII detection and masking of response
 * 4. Structured logging and error handling
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { randomUUID } from 'crypto';

import { PiiService } from './pii.js';
import { createBedrockKnowledgeBase, isGuardrailIntervention } from './bedrock.js';
import type {
  ChatRequest,
  ChatResponse,
  ApiError,
  LogEntry,
  PerformanceMetrics,
  AwsServiceError,
} from './types.js';

/**
 * Environment configuration
 */
interface LambdaConfig {
  knowledgeBaseId: string;
  modelArn: string;
  guardrailId: string;
  guardrailVersion: string;
  region: string;
  logLevel: string;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): LambdaConfig {
  const config: LambdaConfig = {
    knowledgeBaseId: process.env.KB_ID || '',
    modelArn: process.env.MODEL_ARN || '',
    guardrailId: process.env.GUARDRAIL_ID || '',
    guardrailVersion: process.env.GUARDRAIL_VERSION || 'DRAFT',
    region: process.env.AWS_REGION || 'us-east-1',
    logLevel: process.env.LOG_LEVEL || 'INFO',
  };

  // Validate required configuration
  const requiredFields = ['knowledgeBaseId', 'modelArn', 'guardrailId'];
  const missingFields = requiredFields.filter(field => !config[field as keyof LambdaConfig]);
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required environment variables: ${missingFields.join(', ')}`);
  }

  return config;
}

/**
 * Structured logging utility
 */
class Logger {
  private correlationId: string;
  private logLevel: string;

  constructor(correlationId: string, logLevel = 'INFO') {
    this.correlationId = correlationId;
    this.logLevel = logLevel;
  }

  private log(level: LogEntry['level'], message: string, metadata?: Record<string, any>, operation?: string, duration?: number): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.correlationId,
      operation,
      duration,
      metadata,
    };

    console.log(JSON.stringify(logEntry));
  }

  info(message: string, metadata?: Record<string, any>, operation?: string, duration?: number): void {
    this.log('INFO', message, metadata, operation, duration);
  }

  warn(message: string, metadata?: Record<string, any>, operation?: string): void {
    this.log('WARN', message, metadata, operation);
  }

  error(message: string, metadata?: Record<string, any>, operation?: string): void {
    this.log('ERROR', message, metadata, operation);
  }

  debug(message: string, metadata?: Record<string, any>, operation?: string): void {
    if (this.logLevel === 'DEBUG') {
      this.log('DEBUG', message, metadata, operation);
    }
  }
}

/**
 * Request processor that orchestrates the complete flow
 */
class RequestProcessor {
  private piiService: PiiService;
  private bedrockKb: any;
  private logger: Logger;
  private metrics: PerformanceMetrics;

  constructor(config: LambdaConfig, correlationId: string) {
    this.piiService = new PiiService();
    this.bedrockKb = createBedrockKnowledgeBase(
      config.knowledgeBaseId,
      config.modelArn,
      config.guardrailId,
      config.guardrailVersion,
      config.region
    );
    this.logger = new Logger(correlationId, config.logLevel);
    this.metrics = {
      totalLatency: 0,
      guardrailInterventions: 0,
      entitiesDetected: 0,
    };
  }

  /**
   * Process the complete chat request flow
   */
  async processRequest(request: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting request processing', { query: request.query.substring(0, 100) + '...' });

      // Step 1: Pre-PII detection and masking
      const prePiiResult = await this.performPrePiiMasking(request.query);
      
      // Step 2: Query knowledge base with masked input
      const kbResult = await this.queryKnowledgeBase(prePiiResult.maskedText, request.sessionId);
      
      // Step 3: Post-PII detection and masking of response
      const postPiiResult = await this.performPostPiiMasking(kbResult.output.text);
      
      // Step 4: Build final response
      const response = this.buildResponse(
        prePiiResult,
        kbResult,
        postPiiResult,
        request.query
      );

      this.metrics.totalLatency = Date.now() - startTime;
      this.logMetrics();
      
      this.logger.info('Request processing completed successfully', {
        sessionId: response.sessionId,
        citationCount: response.citations.length,
        guardrailAction: response.guardrailAction,
      }, 'request_complete', this.metrics.totalLatency);

      return response;

    } catch (error) {
      this.metrics.totalLatency = Date.now() - startTime;
      this.handleProcessingError(error);
      throw error;
    }
  }

  /**
   * Step 1: Pre-PII detection and masking
   */
  private async performPrePiiMasking(query: string) {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting pre-PII detection', undefined, 'pre_pii_detection');
      
      const result = await this.piiService.redactPII(query);
      
      this.metrics.piiDetectionLatency = Date.now() - startTime;
      this.metrics.entitiesDetected += result.entitiesFound.length;
      
      this.logger.info('Pre-PII detection completed', {
        entitiesFound: result.entitiesFound.length,
        entityTypes: result.entitiesFound.map(e => e.Type),
      }, 'pre_pii_detection', this.metrics.piiDetectionLatency);

      return result;
      
    } catch (error) {
      this.logger.error('Pre-PII detection failed', { error: (error as Error).message }, 'pre_pii_detection');
      throw new Error(`PII detection failed: ${(error as Error).message}`);
    }
  }

  /**
   * Step 2: Query knowledge base
   */
  private async queryKnowledgeBase(maskedQuery: string, sessionId?: string) {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting knowledge base query', { sessionId }, 'kb_query');
      
      const result = await this.bedrockKb.askKb(maskedQuery, sessionId);
      
      this.metrics.knowledgeBaseLatency = Date.now() - startTime;
      
      if (result.guardrailAction === 'INTERVENED') {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn('Guardrail intervention occurred', {
          sessionId: result.sessionId,
          guardrailAction: result.guardrailAction,
        }, 'kb_query');
      }
      
      this.logger.info('Knowledge base query completed', {
        sessionId: result.sessionId,
        citationCount: result.citations.length,
        guardrailAction: result.guardrailAction,
        responseLength: result.output.text.length,
      }, 'kb_query', this.metrics.knowledgeBaseLatency);

      return result;
      
    } catch (error) {
      const awsError = error as AwsServiceError;
      
      // Handle guardrail interventions as special case
      if (isGuardrailIntervention(awsError)) {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn('Guardrail intervention detected', {
          errorName: awsError.name,
          errorMessage: awsError.message,
        }, 'kb_query');
        
        // Return a structured response for guardrail interventions
        return {
          output: { text: 'I cannot provide a response to that query as it violates content policies.' },
          citations: [],
          guardrailAction: 'INTERVENED' as const,
          sessionId: sessionId || `session-${Date.now()}`,
        };
      }
      
      this.logger.error('Knowledge base query failed', {
        error: awsError.message,
        errorName: awsError.name,
        statusCode: awsError.statusCode,
        retryable: awsError.retryable,
      }, 'kb_query');
      
      throw new Error(`Knowledge base query failed: ${awsError.message}`);
    }
  }

  /**
   * Step 3: Post-PII detection and masking
   */
  private async performPostPiiMasking(response: string) {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting post-PII detection', undefined, 'post_pii_detection');
      
      const result = await this.piiService.redactPII(response);
      
      const postPiiLatency = Date.now() - startTime;
      this.metrics.entitiesDetected += result.entitiesFound.length;
      
      // Add to total PII detection latency
      this.metrics.piiDetectionLatency = (this.metrics.piiDetectionLatency || 0) + postPiiLatency;
      
      this.logger.info('Post-PII detection completed', {
        entitiesFound: result.entitiesFound.length,
        entityTypes: result.entitiesFound.map(e => e.Type),
      }, 'post_pii_detection', postPiiLatency);

      return result;
      
    } catch (error) {
      this.logger.error('Post-PII detection failed', { error: (error as Error).message }, 'post_pii_detection');
      throw new Error(`Post-PII detection failed: ${(error as Error).message}`);
    }
  }

  /**
   * Build the final response
   */
  private buildResponse(prePiiResult: any, kbResult: any, postPiiResult: any, originalQuery: string): ChatResponse {
    return {
      answer: postPiiResult.maskedText,
      citations: kbResult.citations,
      guardrailAction: kbResult.guardrailAction,
      sessionId: kbResult.sessionId,
      redactedQuery: prePiiResult.maskedText !== originalQuery ? prePiiResult.maskedText : undefined,
      redactedAnswer: postPiiResult.maskedText !== postPiiResult.originalText ? postPiiResult.maskedText : undefined,
    };
  }

  /**
   * Log performance metrics
   */
  private logMetrics(): void {
    this.logger.info('Performance metrics', this.metrics, 'metrics');
  }

  /**
   * Handle processing errors with appropriate logging
   */
  private handleProcessingError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    this.logger.error('Request processing failed', {
      error: errorMessage,
      totalLatency: this.metrics.totalLatency,
      metrics: this.metrics,
    }, 'request_error');
  }
}

/**
 * Validate and parse request body
 */
function parseRequest(event: APIGatewayProxyEvent): ChatRequest {
  if (!event.body) {
    throw new Error('Request body is required');
  }

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(event.body);
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }

  if (!parsedBody.query || typeof parsedBody.query !== 'string') {
    throw new Error('Query field is required and must be a string');
  }

  if (parsedBody.query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  if (parsedBody.query.length > 10000) {
    throw new Error('Query exceeds maximum length of 10,000 characters');
  }

  return {
    query: parsedBody.query.trim(),
    sessionId: parsedBody.sessionId || undefined,
  };
}

/**
 * Create error response
 */
function createErrorResponse(
  error: string,
  message: string,
  statusCode: number,
  correlationId: string
): APIGatewayProxyResult {
  const errorResponse: ApiError = {
    error,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    correlationId,
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://d75yomy6kysc3.cloudfront.net',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key',
      'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
      'X-Correlation-ID': correlationId,
    },
    body: JSON.stringify(errorResponse),
  };
}

/**
 * Create success response
 */
function createSuccessResponse(
  data: ChatResponse,
  correlationId: string
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://d75yomy6kysc3.cloudfront.net',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key',
      'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
      'X-Correlation-ID': correlationId,
    },
    body: JSON.stringify(data),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = randomUUID();
  const logger = new Logger(correlationId);

  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    logger.info('Handling OPTIONS preflight request', {
      path: event.path,
      headers: event.headers,
    });
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://d75yomy6kysc3.cloudfront.net',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key',
        'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
      body: '',
    };
  }

  logger.info('Lambda invocation started', {
    requestId: context.awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
    userAgent: event.headers['User-Agent'],
  });

  try {
    // Load configuration
    const config = loadConfig();
    
    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      return createErrorResponse(
        'MethodNotAllowed',
        'Only POST method is allowed',
        405,
        correlationId
      );
    }

    // Parse and validate request
    const request = parseRequest(event);
    
    // Process the request
    const processor = new RequestProcessor(config, correlationId);
    const response = await processor.processRequest(request);
    
    logger.info('Lambda invocation completed successfully', {
      requestId: context.awsRequestId,
      sessionId: response.sessionId,
    });

    return createSuccessResponse(response, correlationId);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    
    logger.error('Lambda invocation failed', {
      requestId: context.awsRequestId,
      error: errorMessage,
    });

    // Determine appropriate status code based on error type
    let statusCode = 500;
    if (errorMessage.includes('Missing required environment')) {
      statusCode = 500;
    } else if (errorMessage.includes('required') || 
        errorMessage.includes('Invalid') || 
        errorMessage.includes('exceeds maximum') ||
        errorMessage.includes('cannot be empty')) {
      statusCode = 400;
    }

    return createErrorResponse(
      'ProcessingError',
      errorMessage,
      statusCode,
      correlationId
    );
  }
}