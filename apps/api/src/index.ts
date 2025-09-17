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
import { KnowledgeBaseService } from "./services/knowledgeBase.js";
import type { KnowledgeBaseAnswer } from "./services/knowledgeBase.js";
import {
  chooseGuardrailId,
  type GuardrailDefinitions,
  type GuardrailSelectionResult,
} from "./safety/guardrailRouting.js";
import type {
  ChatRequest,
  ChatResponse,
  ApiError,
  LogEntry,
  PerformanceMetrics,
  AwsServiceError,
} from "./types.js";

/**
 * Environment configuration
 */
interface LambdaConfig {
  knowledgeBaseId: string;
  modelArn: string;
  guardrails: GuardrailDefinitions;
  region: string;
  logLevel: string;
  allowedOrigins: string[];
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): LambdaConfig {
  const defaultGuardrailId =
    process.env.GR_DEFAULT_ID || process.env.GUARDRAIL_ID || "";
  const defaultGuardrailVersion =
    process.env.GR_DEFAULT_VERSION || process.env.GUARDRAIL_VERSION || "DRAFT";

  const guardrails: GuardrailDefinitions = {
    default: {
      guardrailId: defaultGuardrailId,
      guardrailVersion: defaultGuardrailVersion,
    },
  };

  const complianceGuardrailId = process.env.GR_COMPLIANCE_ID;
  const complianceGuardrailVersion =
    process.env.GR_COMPLIANCE_VERSION || defaultGuardrailVersion;

  if (complianceGuardrailId) {
    guardrails.compliance = {
      guardrailId: complianceGuardrailId,
      guardrailVersion: complianceGuardrailVersion,
    };
  }

  const config: LambdaConfig = {
    knowledgeBaseId: process.env.KB_ID || "",
    modelArn: process.env.MODEL_ARN || "",
    guardrails,
    region: process.env.AWS_REGION || "us-east-1",
    logLevel: process.env.LOG_LEVEL || "INFO",
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
    ],
  };

  // Validate required configuration
  const missingFields = [] as string[];

  if (!config.knowledgeBaseId) {
    missingFields.push("KB_ID");
  }

  if (!config.modelArn) {
    missingFields.push("MODEL_ARN");
  }

  if (!config.guardrails.default.guardrailId) {
    missingFields.push("GR_DEFAULT_ID");
  }

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
  private knowledgeBase: KnowledgeBaseService;
  private logger: Logger;
  private metrics: PerformanceMetrics;
  private guardrails: GuardrailDefinitions;

  constructor(config: LambdaConfig, correlationId: string) {
    this.piiService = new PiiService();
    this.guardrails = config.guardrails;
    const bedrockClient = createBedrockKnowledgeBase(
      config.knowledgeBaseId,
      config.modelArn,
      this.guardrails.default.guardrailId,
      this.guardrails.default.guardrailVersion,
      config.region
    );
    this.knowledgeBase = new KnowledgeBaseService(bedrockClient);
    this.logger = new Logger(correlationId, config.logLevel);
    this.metrics = {
      totalLatency: 0,
      guardrailInterventions: 0,
      entitiesDetected: 0,
      knowledgeBaseRetries: 0,
      knowledgeBaseCacheHit: false,
      knowledgeBaseDegraded: false,
      contextRetryCount: 0,
      contextCacheHit: false,
      contextDegraded: false,
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

      // Step 2: Retrieve knowledge base context for guardrail routing
      const contextSnippets = await this.retrieveContext(prePiiResult.maskedText);

      // Step 3: Determine guardrail configuration
      const guardrailSelection = await this.determineGuardrail(
        request.query,
        contextSnippets
      );

      // Step 4: Query knowledge base with selected guardrail
      const kbResult = await this.queryKnowledgeBase(
        prePiiResult.maskedText,
        request.sessionId,
        guardrailSelection
      );

      // Step 5: Post-PII detection and masking of response
      const postPiiResult = await this.performPostPiiMasking(
        kbResult.output.text
      );

      // Step 6: Build final response
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

  private async retrieveContext(maskedQuery: string): Promise<string[]> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        "Retrieving knowledge base context",
        undefined,
        "kb_retrieve"
      );

      const contextResult = await this.knowledgeBase.retrieveContext(maskedQuery, {
        intent: "guardrail_context",
        guardrail: this.guardrails.default,
      });

      this.metrics.contextRetrievalLatency = Date.now() - startTime;
      this.metrics.contextRetryCount = contextResult.metadata.retryCount;
      this.metrics.contextCacheHit = contextResult.metadata.cacheHit;
      this.metrics.contextDegraded = contextResult.metadata.degraded;

      const baseMetadata = {
        snippetCount: contextResult.snippets.length,
        retryCount: contextResult.metadata.retryCount,
        cacheHit: contextResult.metadata.cacheHit,
        kb_degraded: contextResult.metadata.degraded,
      };

      if (contextResult.metadata.degraded) {
        this.logger.warn(
          "Knowledge base context retrieval throttled; proceeding with default guardrail",
          {
            ...baseMetadata,
            errorName: contextResult.error?.name,
            statusCode: contextResult.error?.statusCode,
          },
          "kb_retrieve"
        );
        return [];
      }

      if (contextResult.error) {
        this.logger.warn(
          "Context retrieval failed; proceeding with default guardrail",
          {
            ...baseMetadata,
            error: contextResult.error.message,
            errorName: contextResult.error.name,
            statusCode: contextResult.error.statusCode,
          },
          "kb_retrieve"
        );
        return [];
      }

      this.logger.info(
        "Knowledge base context retrieved",
        baseMetadata,
        "kb_retrieve",
        this.metrics.contextRetrievalLatency
      );

      return contextResult.snippets;
    } catch (error) {
      this.metrics.contextRetrievalLatency = Date.now() - startTime;
      this.metrics.contextRetryCount = 0;
      this.metrics.contextCacheHit = false;
      this.metrics.contextDegraded = false;
      this.logger.warn(
        "Context retrieval failed; proceeding with default guardrail",
        { error: (error as Error).message },
        "kb_retrieve"
      );
      return [];
    }
  }

  private async determineGuardrail(
    prompt: string,
    contextSnippets: string[]
  ): Promise<GuardrailSelectionResult> {
    const startTime = Date.now();

    try {
      const selection = await chooseGuardrailId({
        prompt,
        contextTexts: contextSnippets,
        guardrails: this.guardrails,
        piiService: this.piiService,
        logger: this.logger,
      });

      this.metrics.guardrailSelectionLatency = Date.now() - startTime;

      this.logger.info(
        "Guardrail selection completed",
        {
          guardrailId: selection.guardrail.guardrailId,
          guardrailVersion: selection.guardrail.guardrailVersion,
          usedComplianceGuardrail: selection.usedCompliance,
          detectedEntities: selection.detection?.entities.length ?? 0,
        },
        "guardrail_selection",
        this.metrics.guardrailSelectionLatency
      );

      return selection;
    } catch (error) {
      this.metrics.guardrailSelectionLatency = Date.now() - startTime;
      this.logger.warn(
        "Guardrail selection failed; using default guardrail",
        { error: (error as Error).message },
        "guardrail_selection"
      );
      return {
        guardrail: this.guardrails.default,
        usedCompliance: false,
      };
    }
  }

  /**
   * Step 2: Query knowledge base
   */
  private async queryKnowledgeBase(
    maskedQuery: string,
    sessionId: string | undefined,
    guardrailSelection: GuardrailSelectionResult
  ) {
    const startTime = Date.now();

    try {
      this.logger.debug(
        "Starting knowledge base query",
        {
          sessionId,
          guardrailId: guardrailSelection.guardrail.guardrailId,
          guardrailVersion: guardrailSelection.guardrail.guardrailVersion,
          usedComplianceGuardrail: guardrailSelection.usedCompliance,
        },
        "kb_query"
      );

      const kbResult = await this.knowledgeBase.askKnowledgeBase({
        prompt: maskedQuery,
        sessionId,
        guardrail: guardrailSelection.guardrail,
        intent: guardrailSelection.usedCompliance ? "compliance" : "default",
      });

      this.metrics.knowledgeBaseLatency = Date.now() - startTime;
      this.metrics.knowledgeBaseRetries = kbResult.metadata.retryCount;
      this.metrics.knowledgeBaseCacheHit = kbResult.metadata.cacheHit;
      this.metrics.knowledgeBaseDegraded = kbResult.metadata.degraded;

      if (kbResult.metadata.degraded) {
        this.logger.warn(
          "Knowledge base query degraded; returning unsourced response",
          {
            sessionId: kbResult.sessionId,
            guardrailId: guardrailSelection.guardrail.guardrailId,
            guardrailVersion: guardrailSelection.guardrail.guardrailVersion,
            usedComplianceGuardrail: guardrailSelection.usedCompliance,
            retryCount: kbResult.metadata.retryCount,
            cacheHit: kbResult.metadata.cacheHit,
            kb_degraded: true,
            errorName: kbResult.error?.name,
            statusCode: kbResult.error?.statusCode,
          },
          "kb_query",
          this.metrics.knowledgeBaseLatency
        );

        return kbResult;
      }

      if (kbResult.guardrailAction === "INTERVENED") {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn(
          "Guardrail intervention occurred",
          {
            sessionId: kbResult.sessionId,
            guardrailAction: kbResult.guardrailAction,
            guardrailId: guardrailSelection.guardrail.guardrailId,
            usedComplianceGuardrail: guardrailSelection.usedCompliance,
            retryCount: kbResult.metadata.retryCount,
            cacheHit: kbResult.metadata.cacheHit,
            kb_degraded: false,
          },
          "kb_query"
        );

        return {
          ...kbResult,
          output: {
            text: "I cannot provide a response to that query as it violates content policies.",
          },
          citations: [],
          metadata: {
            ...kbResult.metadata,
            degraded: false,
          },
        };
      }

      this.logger.info(
        "Knowledge base query completed",
        {
          sessionId: kbResult.sessionId,
          citationCount: kbResult.citations.length,
          guardrailAction: kbResult.guardrailAction,
          guardrailId: guardrailSelection.guardrail.guardrailId,
          guardrailVersion: guardrailSelection.guardrail.guardrailVersion,
          usedComplianceGuardrail: guardrailSelection.usedCompliance,
          responseLength: kbResult.output.text.length,
          retryCount: kbResult.metadata.retryCount,
          cacheHit: kbResult.metadata.cacheHit,
          kb_degraded: false,
        },
        "kb_query",
        this.metrics.knowledgeBaseLatency
      );

      return kbResult;
    } catch (error) {
      const awsError = error as AwsServiceError;
      this.metrics.knowledgeBaseLatency = Date.now() - startTime;

      if (isGuardrailIntervention(awsError)) {
        this.metrics.guardrailInterventions += 1;
        this.logger.warn(
          "Guardrail intervention detected",
          {
            errorName: awsError.name,
            errorMessage: awsError.message,
            details: awsError.details,
            guardrailId: guardrailSelection.guardrail.guardrailId,
            guardrailVersion: guardrailSelection.guardrail.guardrailVersion,
            usedComplianceGuardrail: guardrailSelection.usedCompliance,
          },
          "kb_query"
        );

        this.metrics.knowledgeBaseRetries = awsError.retries;
        this.metrics.knowledgeBaseCacheHit = false;
        this.metrics.knowledgeBaseDegraded = false;

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
          retryCount: awsError.retries,
          guardrailId: guardrailSelection.guardrail.guardrailId,
          guardrailVersion: guardrailSelection.guardrail.guardrailVersion,
          usedComplianceGuardrail: guardrailSelection.usedCompliance,
        },
        "kb_query"
      );

      this.metrics.knowledgeBaseRetries = awsError.retries;
      this.metrics.knowledgeBaseCacheHit = false;
      this.metrics.knowledgeBaseDegraded = false;

      throw new Error(`Knowledge base query failed: ${awsError.message}`);
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
    kbResult: KnowledgeBaseAnswer,
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
