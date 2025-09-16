/**
 * FedRag Privacy RAG Assistant - Lambda Handler
 *
 * Main Lambda handler that orchestrates the complete request flow:
 * 1. Pre-PII detection and masking of user input
 * 2. Knowledge base query with masked input
 * 3. Post-PII detection and masking of response
 * 4. Structured logging and error handling
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { randomUUID } from "crypto";

import { PiiService } from "./pii.js";
import {
  createBedrockKnowledgeBase,
  isGuardrailIntervention,
} from "./bedrock.js";
import type {
  ChatRequest,
  ChatResponse,
  ApiError,
  LogEntry,
  PerformanceMetrics,
  AwsServiceError,
  BedrockRetrieveAndGenerateResponse,
} from "./types.js";

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
  allowedOrigins: string[];
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): LambdaConfig {
  const config: LambdaConfig = {
    knowledgeBaseId: process.env.KB_ID || "",
    modelArn: process.env.MODEL_ARN || "",
    guardrailId: process.env.GUARDRAIL_ID || "",
    guardrailVersion: process.env.GUARDRAIL_VERSION || "DRAFT",
    region: process.env.AWS_REGION || "us-east-1",
    logLevel: process.env.LOG_LEVEL || "INFO",
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
    ],
  };

  // Validate required configuration
  const requiredFields = ["knowledgeBaseId", "modelArn", "guardrailId"];
  const missingFields = requiredFields.filter(
    (field) => !config[field as keyof LambdaConfig]
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingFields.join(", ")}`
    );
  }

  return config;
}

/**
 * Structured logging utility
 */
class Logger {
  private correlationId: string;
  private logLevel: string;

  constructor(correlationId: string, logLevel = "INFO") {
    this.correlationId = correlationId;
    this.logLevel = logLevel;
  }

  private log(
    level: LogEntry["level"],
    message: string,
    metadata?: Record<string, any>,
    operation?: string,
    duration?: number
  ): void {
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

  info(
    message: string,
    metadata?: Record<string, any>,
    operation?: string,
    duration?: number
  ): void {
    this.log("INFO", message, metadata, operation, duration);
  }

  warn(
    message: string,
    metadata?: Record<string, any>,
    operation?: string
  ): void {
    this.log("WARN", message, metadata, operation);
  }

  error(
    message: string,
    metadata?: Record<string, any>,
    operation?: string
  ): void {
    this.log("ERROR", message, metadata, operation);
  }

  debug(
    message: string,
    metadata?: Record<string, any>,
    operation?: string
  ): void {
    if (this.logLevel === "DEBUG") {
      this.log("DEBUG", message, metadata, operation);
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
      this.logger.info("Starting request processing", {
        query: request.query.substring(0, 100) + "...",
      });

      // Step 1: Pre-PII detection and masking
      const prePiiResult = await this.performPrePiiMasking(request.query);

      // Step 2: Query knowledge base with masked input
      const kbResult = await this.queryKnowledgeBase(
        prePiiResult.maskedText,
        request.sessionId,
        request.query
      );

      // Step 3: Post-PII detection and masking of response
      const postPiiResult = await this.performPostPiiMasking(
        kbResult.output.text
      );

      // Step 4: Build final response
      const response = this.buildResponse(
        prePiiResult,
        kbResult,
        postPiiResult,
        request.query
      );

      this.metrics.totalLatency = Date.now() - startTime;
      this.logMetrics();

      this.logger.info(
        "Request processing completed successfully",
        {
          sessionId: response.sessionId,
          citationCount: response.citations.length,
          guardrailAction: response.guardrailAction,
        },
        "request_complete",
        this.metrics.totalLatency
      );

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
      this.logger.debug(
        "Starting pre-PII detection",
        undefined,
        "pre_pii_detection"
      );

      const result = await this.piiService.redactPII(query);

      this.metrics.piiDetectionLatency = Date.now() - startTime;
      this.metrics.entitiesDetected += result.entitiesFound.length;

      this.logger.info(
        "Pre-PII detection completed",
        {
          entitiesFound: result.entitiesFound.length,
          entityTypes: result.entitiesFound.map((e) => e.Type),
        },
        "pre_pii_detection",
        this.metrics.piiDetectionLatency
      );

      return result;
    } catch (error) {
      this.logger.error(
        "Pre-PII detection failed",
        { error: (error as Error).message },
        "pre_pii_detection"
      );
      throw new Error(`PII detection failed: ${(error as Error).message}`);
    }
  }

  /**
   * Step 2: Query knowledge base
   */
  private async queryKnowledgeBase(
    maskedQuery: string,
    sessionId: string | undefined,
    originalQuery: string
  ) {
    const startTime = Date.now();

    try {
      this.logger.debug(
        "Starting knowledge base query",
        { sessionId },
        "kb_query"
      );

      const result = await this.bedrockKb.askKb(maskedQuery, sessionId);

      this.metrics.knowledgeBaseLatency = Date.now() - startTime;

      if (result.guardrailAction === "INTERVENED") {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn(
          "Guardrail intervention occurred",
          {
            sessionId: result.sessionId,
            guardrailAction: result.guardrailAction,
          },
          "kb_query"
        );
      }

      this.logger.info(
        "Knowledge base query completed",
        {
          sessionId: result.sessionId,
          citationCount: result.citations.length,
          guardrailAction: result.guardrailAction,
          responseLength: result.output.text.length,
        },
        "kb_query",
        this.metrics.knowledgeBaseLatency
      );

      return result;
    } catch (error) {
      const awsError = error as AwsServiceError;

      // Handle guardrail interventions as special case
      if (isGuardrailIntervention(awsError)) {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn(
          "Guardrail intervention detected",
          {
            errorName: awsError.name,
            errorMessage: awsError.message,
            details: awsError.details,
          },
          "kb_query"
        );

        if (this.guardrailIndicatesPersonalInformation(awsError)) {
          this.logger.info(
            'Personal information guardrail triggered, verifying compliance intent',
            {
              sessionId,
              guardrailDetails: awsError.details,
            },
            'kb_query'
          );

          const bypassResult = await this.attemptPersonalInfoComplianceBypass(
            maskedQuery,
            originalQuery,
            sessionId
          );

          if (bypassResult) {
            this.metrics.knowledgeBaseLatency = Date.now() - startTime;
            this.logger.info(
              'Knowledge base query completed after compliance bypass',
              {
                sessionId: bypassResult.sessionId,
                citationCount: bypassResult.citations.length,
                guardrailAction: bypassResult.guardrailAction,
                responseLength: bypassResult.output.text.length,
              },
              'kb_query',
              this.metrics.knowledgeBaseLatency
            );
            return bypassResult;
          }
        }

        // Return a structured response for guardrail interventions
        return {
          output: {
            text: "I cannot provide a response to that query as it violates content policies.",
          },
          citations: [],
          guardrailAction: "INTERVENED" as const,
          sessionId: sessionId || `session-${Date.now()}`,
        };
      }

      this.logger.error(
        "Knowledge base query failed",
        {
          error: awsError.message,
          errorName: awsError.name,
          statusCode: awsError.statusCode,
          retryable: awsError.retryable,
        },
        "kb_query"
      );

      throw new Error(`Knowledge base query failed: ${awsError.message}`);
    }
  }

  private guardrailIndicatesPersonalInformation(error: AwsServiceError): boolean {
    const combinedMessage = `${error.details || ''} ${error.message || ''}`
      .toLowerCase();

    if (!combinedMessage.trim()) {
      return false;
    }

    const personalKeywords = [
      'personal-information',
      'personal information',
      'personally identifiable',
      'pii',
      'personal data',
      'sensitive personal',
      'customer pii',
      'contact information',
      'social security',
      'ssn',
    ];

    return personalKeywords.some((keyword) =>
      combinedMessage.includes(keyword)
    );
  }

  private isComplianceIntent(query: string): boolean {
    if (!query) {
      return false;
    }

    const normalized = query.toLowerCase();
    const complianceKeywords = [
      'compliance',
      'comply',
      'policy',
      'policies',
      'procedure',
      'procedures',
      'guideline',
      'guidelines',
      'requirement',
      'requirements',
      'regulation',
      'regulations',
      'standard',
      'standards',
      'best practice',
      'best practices',
      'allowed',
      'permitted',
      'how should',
      'process',
      'processes',
      'governance',
    ];

    const piiContextKeywords = [
      'pii',
      'personal information',
      'personal data',
      'personally identifiable',
      'sensitive data',
      'customer data',
      'data handling',
      'data retention',
      'data protection',
      'privacy',
      'data request',
      'data requests',
      'social security',
      'ssn',
      'phi',
    ];

    const hasCompliance = complianceKeywords.some((keyword) =>
      normalized.includes(keyword)
    );
    const hasDataContext = piiContextKeywords.some((keyword) =>
      normalized.includes(keyword)
    );

    return hasCompliance && hasDataContext;
  }

  private async attemptPersonalInfoComplianceBypass(
    maskedQuery: string,
    originalQuery: string,
    sessionId: string | undefined
  ): Promise<BedrockRetrieveAndGenerateResponse | null> {
    let verificationResult;
    try {
      verificationResult = await this.piiService.redactPII(originalQuery);
    } catch (piiError) {
      this.logger.error(
        'Compliance bypass verification failed',
        { error: (piiError as Error).message },
        'kb_query'
      );
      return null;
    }

    if (verificationResult.entitiesFound.length > 0) {
      this.logger.warn(
        'Compliance bypass skipped: detected PII during verification',
        {
          entityTypes: verificationResult.entitiesFound.map((e) => e.Type),
          entityCount: verificationResult.entitiesFound.length,
        },
        'kb_query'
      );
      return null;
    }

    if (!this.isComplianceIntent(originalQuery)) {
      this.logger.warn(
        'Compliance bypass skipped: query did not match compliance intent',
        undefined,
        'kb_query'
      );
      return null;
    }

    try {
      this.logger.info(
        'Retrying knowledge base query without guardrail after compliance verification',
        { sessionId },
        'kb_query'
      );

      const retryResult = await this.bedrockKb.askKb(maskedQuery, sessionId, {
        disableGuardrail: true,
      });

      return retryResult;
    } catch (retryError) {
      this.logger.error(
        'Knowledge base retry without guardrail failed',
        { error: (retryError as Error).message },
        'kb_query'
      );
      throw retryError;
    }
  }

  /**
   * Step 3: Post-PII detection and masking
   */
  private async performPostPiiMasking(response: string) {
    const startTime = Date.now();

    try {
      this.logger.debug(
        "Starting post-PII detection",
        undefined,
        "post_pii_detection"
      );

      const result = await this.piiService.redactPII(response);

      const postPiiLatency = Date.now() - startTime;
      this.metrics.entitiesDetected += result.entitiesFound.length;

      // Add to total PII detection latency
      this.metrics.piiDetectionLatency =
        (this.metrics.piiDetectionLatency || 0) + postPiiLatency;

      this.logger.info(
        "Post-PII detection completed",
        {
          entitiesFound: result.entitiesFound.length,
          entityTypes: result.entitiesFound.map((e) => e.Type),
        },
        "post_pii_detection",
        postPiiLatency
      );

      return result;
    } catch (error) {
      this.logger.error(
        "Post-PII detection failed",
        { error: (error as Error).message },
        "post_pii_detection"
      );
      throw new Error(`Post-PII detection failed: ${(error as Error).message}`);
    }
  }

  /**
   * Build the final response
   */
  private buildResponse(
    prePiiResult: any,
    kbResult: any,
    postPiiResult: any,
    originalQuery: string
  ): ChatResponse {
    return {
      answer: postPiiResult.maskedText,
      citations: kbResult.citations,
      guardrailAction: kbResult.guardrailAction,
      sessionId: kbResult.sessionId,
      redactedQuery:
        prePiiResult.maskedText !== originalQuery
          ? prePiiResult.maskedText
          : undefined,
      redactedAnswer:
        postPiiResult.maskedText !== postPiiResult.originalText
          ? postPiiResult.maskedText
          : undefined,
    };
  }

  /**
   * Log performance metrics
   */
  private logMetrics(): void {
    this.logger.info("Performance metrics", this.metrics, "metrics");
  }

  /**
   * Handle processing errors with appropriate logging
   */
  private handleProcessingError(error: unknown): void {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    this.logger.error(
      "Request processing failed",
      {
        error: errorMessage,
        totalLatency: this.metrics.totalLatency,
        metrics: this.metrics,
      },
      "request_error"
    );
  }
}

/**
 * Retrieve a header value from the event in a case-insensitive manner
 */
function getHeaderValue(
  headers: APIGatewayProxyEventV2["headers"],
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

/**
 * Get the appropriate CORS origin based on the request
 */
function getCorsOrigin(
  event: APIGatewayProxyEventV2,
  allowedOrigins: string[]
): string {
  const requestOrigin = getHeaderValue(event.headers, "origin");
  const defaultOrigin =
    allowedOrigins.find((origin) => !origin.includes("localhost")) ??
    allowedOrigins[0] ??
    "*";

  // If no origin in request, use the first allowed origin (for non-browser requests)
  if (!requestOrigin) {
    return defaultOrigin;
  }

  // Check if the request origin is in our allowed list
  if (allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // For development, allow localhost origins
  if (requestOrigin.includes("localhost")) {
    return requestOrigin;
  }

  // Default to the first non-localhost origin
  return defaultOrigin;
}

/**
 * Validate and parse request body
 */
function parseRequest(event: APIGatewayProxyEventV2): ChatRequest {
  if (!event.body) {
    throw new Error("Request body is required");
  }

  const body =
    event.isBase64Encoded && event.body
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body;

  let parsedBody: any;
  try {
    parsedBody = JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON in request body");
  }

  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("Request body must be a valid JSON object");
  }

  if (!parsedBody.query || typeof parsedBody.query !== "string") {
    throw new Error("Query field is required and must be a string");
  }

  if (parsedBody.query.trim().length === 0) {
    throw new Error("Query cannot be empty");
  }

  if (parsedBody.query.length > 10000) {
    throw new Error("Query exceeds maximum length of 10,000 characters");
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
  correlationId: string,
  corsOrigin: string
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
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key",
      "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
      "X-Correlation-ID": correlationId,
    },
    body: JSON.stringify(errorResponse),
  };
}

/**
 * Create success response
 */
function createSuccessResponse(
  data: ChatResponse,
  correlationId: string,
  corsOrigin: string
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key",
      "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
      "X-Correlation-ID": correlationId,
    },
    body: JSON.stringify(data),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = randomUUID();
  const logger = new Logger(correlationId);

  // Load configuration early to get allowed origins
  let config: LambdaConfig;
  try {
    config = loadConfig();
  } catch (error) {
    // If config fails, use basic CORS for error response
    return createErrorResponse(
      "ConfigurationError",
      (error as Error).message,
      500,
      correlationId,
      "*"
    );
  }

  const corsOrigin = getCorsOrigin(event, config.allowedOrigins);

  const rawMethod =
    event.requestContext?.http?.method ??
    (event as any).httpMethod ??
    (event.requestContext as any)?.httpMethod ??
    "";
  const method = rawMethod ? rawMethod.toUpperCase() : "";
  const path =
    event.rawPath ??
    event.requestContext?.http?.path ??
    (event as any).path ??
    (event.requestContext as any)?.path ??
    "/";

  logger.info("Lambda invocation started", {
    requestId: context.awsRequestId,
    httpMethod: method,
    path,
    userAgent: getHeaderValue(event.headers, "user-agent"),
    corsOrigin,
  });

  // Handle CORS preflight requests FIRST, before any other validation
  if (method === "OPTIONS") {
    logger.info("Handling OPTIONS preflight request", {
      path,
      origin: corsOrigin,
      requestOrigin: getHeaderValue(event.headers, "origin"),
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Headers":
          "Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key",
        "Access-Control-Allow-Methods": "GET,OPTIONS,POST",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
      body: "",
    };
  }

  try {
    // Validate HTTP method for non-OPTIONS requests
    if (method !== "POST" && method !== "GET") {
      return createErrorResponse(
        "MethodNotAllowed",
        "Only POST and GET methods are allowed",
        405,
        correlationId,
        corsOrigin
      );
    }

    // Handle GET requests (health check)
    if (method === "GET") {
      if (path === "/health") {
        return createSuccessResponse(
          {
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: "1.0.0",
          } as any,
          correlationId,
          corsOrigin
        );
      } else {
        return createErrorResponse(
          "NotFound",
          "Endpoint not found",
          404,
          correlationId,
          corsOrigin
        );
      }
    }

    // Parse and validate request
    const request = parseRequest(event);

    // Process the request
    const processor = new RequestProcessor(config, correlationId);
    const response = await processor.processRequest(request);

    logger.info("Lambda invocation completed successfully", {
      requestId: context.awsRequestId,
      sessionId: response.sessionId,
    });

    return createSuccessResponse(response, correlationId, corsOrigin);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";

    logger.error("Lambda invocation failed", {
      requestId: context.awsRequestId,
      error: errorMessage,
    });

    // Determine appropriate status code based on error type
    let statusCode = 500;
    if (errorMessage.includes("Missing required environment")) {
      statusCode = 500;
    } else if (
      errorMessage.includes("required") ||
      errorMessage.includes("Invalid") ||
      errorMessage.includes("exceeds maximum") ||
      errorMessage.includes("cannot be empty")
    ) {
      statusCode = 400;
    }

    return createErrorResponse(
      "ProcessingError",
      errorMessage,
      statusCode,
      correlationId,
      corsOrigin
    );
  }
}
