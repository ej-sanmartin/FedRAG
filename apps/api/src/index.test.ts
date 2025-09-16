/**
 * Integration tests for Lambda handler with complete request flow
 * 
 * These tests verify the end-to-end functionality of the Lambda handler,
 * including request orchestration, error handling, and response formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from './index.js';

// Mock the AWS SDK clients
vi.mock('@aws-sdk/client-comprehend');
vi.mock('@aws-sdk/client-bedrock-agent-runtime');

// Mock the PII and Bedrock modules
vi.mock('./pii.js', () => ({
  PiiService: vi.fn().mockImplementation(() => ({
    redactPII: vi.fn(),
  })),
}));

vi.mock('./bedrock.js', () => ({
  createBedrockKnowledgeBase: vi.fn().mockReturnValue({
    askKb: vi.fn(),
  }),
  isGuardrailIntervention: vi.fn(),
}));

// Import mocked modules
import { PiiService } from './pii.js';
import { createBedrockKnowledgeBase, isGuardrailIntervention } from './bedrock.js';

describe('Lambda Handler Integration Tests', () => {
  let mockPiiService: any;
  let mockBedrockKb: any;
  let mockEvent: APIGatewayProxyEvent;
  let mockContext: Context;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Set up environment variables
    process.env.KB_ID = 'test-kb-id';
    process.env.MODEL_ARN = 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0';
    process.env.GUARDRAIL_ID = 'test-guardrail-id';
    process.env.GUARDRAIL_VERSION = 'DRAFT';
    process.env.AWS_REGION = 'us-east-1';
    process.env.LOG_LEVEL = 'INFO';

    // Set up mocks
    mockPiiService = {
      redactPII: vi.fn(),
    };
    (PiiService as any).mockImplementation(() => mockPiiService);

    mockBedrockKb = {
      askKb: vi.fn(),
    };
    (createBedrockKnowledgeBase as any).mockReturnValue(mockBedrockKb);
    (isGuardrailIntervention as any).mockReturnValue(false);

    // Create mock event
    mockEvent = {
      httpMethod: 'POST',
      path: '/chat',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'test-agent',
      },
      body: JSON.stringify({
        query: 'What is the policy on data retention?',
        sessionId: 'test-session-123',
      }),
      isBase64Encoded: false,
      multiValueHeaders: {},
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
    };

    // Create mock context
    mockContext = {
      awsRequestId: 'test-request-id',
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: '128',
      remainingTimeInMillis: () => 30000,
      logGroupName: '/aws/lambda/test-function',
      logStreamName: '2024/01/01/[$LATEST]test-stream',
      callbackWaitsForEmptyEventLoop: true,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.KB_ID;
    delete process.env.MODEL_ARN;
    delete process.env.GUARDRAIL_ID;
    delete process.env.GUARDRAIL_VERSION;
    delete process.env.AWS_REGION;
    delete process.env.LOG_LEVEL;
  });

  describe('Successful Request Flow', () => {
    it('should process complete request flow successfully', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'What is the policy on data retention?',
        maskedText: 'What is the policy on data retention?',
        entitiesFound: [],
      };

      const mockKbResult = {
        output: { text: 'Data retention policy requires keeping records for 7 years.' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'Data retention policy requires keeping records for 7 years.',
                span: { start: 0, end: 58 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Policy excerpt about data retention...' },
                location: { s3Location: { uri: 's3://bucket/policy.pdf' } },
                metadata: {},
              },
            ],
          },
        ],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session-123',
      };

      const mockPostPiiResult = {
        originalText: 'Data retention policy requires keeping records for 7 years.',
        maskedText: 'Data retention policy requires keeping records for 7 years.',
        entitiesFound: [],
      };

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockResolvedValue(mockKbResult);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(result.headers['X-Correlation-ID']).toBeDefined();

      const responseBody = JSON.parse(result.body);
      expect(responseBody).toEqual({
        answer: 'Data retention policy requires keeping records for 7 years.',
        citations: mockKbResult.citations,
        guardrailAction: 'NONE',
        sessionId: 'test-session-123',
      });

      // Verify the flow was executed correctly
      expect(mockPiiService.redactPII).toHaveBeenCalledTimes(2);
      expect(mockPiiService.redactPII).toHaveBeenNthCalledWith(1, 'What is the policy on data retention?');
      expect(mockPiiService.redactPII).toHaveBeenNthCalledWith(2, 'Data retention policy requires keeping records for 7 years.');
      expect(mockBedrockKb.askKb).toHaveBeenCalledWith(
        'What is the policy on data retention?',
        'test-session-123'
      );
    });

    it('should include redacted fields when PII is detected', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'What is the policy for john.doe@example.com?',
        maskedText: 'What is the policy for <REDACTED:EMAIL>?',
        entitiesFound: [{ Type: 'EMAIL', Score: 0.99, BeginOffset: 22, EndOffset: 41 }],
      };

      const mockKbResult = {
        output: { text: 'The policy applies to all users including contact at support@company.com.' },
        citations: [],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session-456',
      };

      const mockPostPiiResult = {
        originalText: 'The policy applies to all users including contact at support@company.com.',
        maskedText: 'The policy applies to all users including contact at <REDACTED:EMAIL>.',
        entitiesFound: [{ Type: 'EMAIL', Score: 0.95, BeginOffset: 52, EndOffset: 71 }],
      };

      mockEvent.body = JSON.stringify({
        query: 'What is the policy for john.doe@example.com?',
      });

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockResolvedValue(mockKbResult);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.redactedQuery).toBe('What is the policy for <REDACTED:EMAIL>?');
      expect(responseBody.redactedAnswer).toBe('The policy applies to all users including contact at <REDACTED:EMAIL>.');
    });
  });

  describe('Guardrail Intervention Handling', () => {
    it('should handle guardrail interventions gracefully', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'How to hack into systems?',
        maskedText: 'How to hack into systems?',
        entitiesFound: [],
      };

      const guardrailError = new Error('Content blocked by guardrails');
      (guardrailError as any).name = 'GuardrailIntervention';
      (isGuardrailIntervention as any).mockReturnValue(true);

      mockEvent.body = JSON.stringify({
        query: 'How to hack into systems?',
      });

      const mockPostPiiResult = {
        originalText: 'I cannot provide a response to that query as it violates content policies.',
        maskedText: 'I cannot provide a response to that query as it violates content policies.',
        entitiesFound: [],
      };

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockRejectedValue(guardrailError);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.answer).toBe('I cannot provide a response to that query as it violates content policies.');
      expect(responseBody.guardrailAction).toBe('INTERVENED');
      expect(responseBody.citations).toEqual([]);
    });

    it('should keep personal information guardrail block when PII is detected', async () => {
      const mockPrePiiResult = {
        originalText: "Please share John Doe's SSN 123-45-6789.",
        maskedText: "Please share John Doe's SSN <REDACTED:SSN>.",
        entitiesFound: [
          { Type: 'SSN', Score: 0.98, BeginOffset: 28, EndOffset: 39 },
        ],
      };

      const verificationResult = {
        originalText: "Please share John Doe's SSN 123-45-6789.",
        maskedText: "Please share John Doe's SSN <REDACTED:SSN>.",
        entitiesFound: [
          { Type: 'SSN', Score: 0.98, BeginOffset: 28, EndOffset: 39 },
        ],
      };

      const mockPostPiiResult = {
        originalText: 'I cannot provide a response to that query as it violates content policies.',
        maskedText: 'I cannot provide a response to that query as it violates content policies.',
        entitiesFound: [],
      };

      const guardrailError = {
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
        statusCode: 400,
        retryable: false,
        details: 'Guardrail blocked: personal-information topic detected',
      } as const;

      (isGuardrailIntervention as any).mockReturnValueOnce(true);

      mockEvent.body = JSON.stringify({
        query: "Please share John Doe's SSN 123-45-6789.",
      });

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(verificationResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockRejectedValueOnce(guardrailError);

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.answer).toBe('I cannot provide a response to that query as it violates content policies.');
      expect(responseBody.guardrailAction).toBe('INTERVENED');

      expect(mockBedrockKb.askKb).toHaveBeenCalledTimes(1);
      expect(mockPiiService.redactPII).toHaveBeenNthCalledWith(2, "Please share John Doe's SSN 123-45-6789.");
      expect(mockPiiService.redactPII).toHaveBeenCalledTimes(3);
    });

    it('should handle Bedrock guardrail response correctly', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'Tell me about violence',
        maskedText: 'Tell me about violence',
        entitiesFound: [],
      };

      const mockKbResult = {
        output: { text: 'I cannot provide information about that topic.' },
        citations: [],
        guardrailAction: 'INTERVENED' as const,
        sessionId: 'test-session-789',
      };

      const mockPostPiiResult = {
        originalText: 'I cannot provide information about that topic.',
        maskedText: 'I cannot provide information about that topic.',
        entitiesFound: [],
      };

      mockEvent.body = JSON.stringify({
        query: 'Tell me about violence',
      });

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockResolvedValue(mockKbResult);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.guardrailAction).toBe('INTERVENED');
      expect(responseBody.sessionId).toBe('test-session-789');
    });

    it('should retry compliant personal information queries without guardrail', async () => {
      const mockPrePiiResult = {
        originalText: 'How should our support team handle customer PII requests in compliance with policy?',
        maskedText: 'How should our support team handle customer PII requests in compliance with policy?',
        entitiesFound: [],
      };

      const verificationResult = {
        originalText: 'How should our support team handle customer PII requests in compliance with policy?',
        maskedText: 'How should our support team handle customer PII requests in compliance with policy?',
        entitiesFound: [],
      };

      const mockPostPiiResult = {
        originalText:
          'Compliance guidance: Collect only necessary PII, store it encrypted, and honor deletion requests promptly.',
        maskedText:
          'Compliance guidance: Collect only necessary PII, store it encrypted, and honor deletion requests promptly.',
        entitiesFound: [],
      };

      const guardrailError = {
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
        statusCode: 400,
        retryable: false,
        details: 'Guardrail blocked: personal-information topic detected',
      } as const;

      const mockKbResult = {
        output: {
          text: 'Compliance guidance: Collect only necessary PII, store it encrypted, and honor deletion requests promptly.',
        },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'Compliance guidance',
                span: { start: 0, end: 19 },
              },
            },
            retrievedReferences: [],
          },
        ],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session-123',
      };

      (isGuardrailIntervention as any).mockReturnValueOnce(true);

      mockEvent.body = JSON.stringify({
        query: 'How should our support team handle customer PII requests in compliance with policy?',
        sessionId: 'test-session-123',
      });

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(verificationResult)
        .mockResolvedValueOnce(mockPostPiiResult);

      mockBedrockKb.askKb
        .mockRejectedValueOnce(guardrailError)
        .mockResolvedValueOnce(mockKbResult);

      const result = await handler(mockEvent, mockContext);

      expect(result.statusCode).toBe(200);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.answer).toBe(mockKbResult.output.text);
      expect(responseBody.guardrailAction).toBe('NONE');

      expect(mockBedrockKb.askKb).toHaveBeenCalledTimes(2);
      expect(mockBedrockKb.askKb.mock.calls[1][2]).toEqual({ disableGuardrail: true });
      expect(mockPiiService.redactPII).toHaveBeenCalledTimes(3);
      expect(mockPiiService.redactPII).toHaveBeenNthCalledWith(
        2,
        'How should our support team handle customer PII requests in compliance with policy?'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing environment variables', async () => {
      // Arrange
      delete process.env.KB_ID;

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('ConfigurationError');
      expect(responseBody.message).toContain('Missing required environment variables');
    });

    it('should handle invalid request body', async () => {
      // Arrange
      mockEvent.body = 'invalid json';

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('ProcessingError');
      expect(responseBody.message).toBe('Invalid JSON in request body');
    });

    it('should handle missing query field', async () => {
      // Arrange
      mockEvent.body = JSON.stringify({ sessionId: 'test' });

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Query field is required and must be a string');
    });

    it('should handle empty query', async () => {
      // Arrange
      mockEvent.body = JSON.stringify({ query: '   ' });

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Query cannot be empty');
    });

    it('should handle query exceeding maximum length', async () => {
      // Arrange
      const longQuery = 'a'.repeat(10001);
      mockEvent.body = JSON.stringify({ query: longQuery });

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(400);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toBe('Query exceeds maximum length of 10,000 characters');
    });

    it('should handle PII service errors', async () => {
      // Arrange
      const piiError = new Error('Comprehend service unavailable');
      mockPiiService.redactPII.mockRejectedValue(piiError);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toContain('PII detection failed');
    });

    it('should handle Bedrock service errors', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'Test query',
        maskedText: 'Test query',
        entitiesFound: [],
      };

      const bedrockError = new Error('Bedrock service error');
      (bedrockError as any).name = 'ServiceUnavailableException';

      mockPiiService.redactPII.mockResolvedValue(mockPrePiiResult);
      mockBedrockKb.askKb.mockRejectedValue(bedrockError);
      (isGuardrailIntervention as any).mockReturnValue(false);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(500);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.message).toContain('Knowledge base query failed');
    });
  });

  describe('HTTP Method Handling', () => {
    it('should handle OPTIONS requests for CORS', async () => {
      // Arrange
      mockEvent.httpMethod = 'OPTIONS';

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(200);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(result.headers['Access-Control-Allow-Methods']).toBe('GET,OPTIONS,POST');
      expect(result.body).toBe('');
    });

    it('should reject non-POST methods', async () => {
      // Arrange
      mockEvent.httpMethod = 'GET';

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.statusCode).toBe(404);
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('NotFound');
      expect(responseBody.message).toBe('Endpoint not found');
    });
  });

  describe('Response Headers', () => {
    it('should include proper CORS headers', async () => {
      // Arrange
      const mockPrePiiResult = {
        originalText: 'Test query',
        maskedText: 'Test query',
        entitiesFound: [],
      };

      const mockKbResult = {
        output: { text: 'Test response' },
        citations: [],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session',
      };

      const mockPostPiiResult = {
        originalText: 'Test response',
        maskedText: 'Test response',
        entitiesFound: [],
      };

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockResolvedValue(mockKbResult);

      // Act
      const result = await handler(mockEvent, mockContext);

      // Assert
      expect(result.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(result.headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-user-agent,x-api-key');
      expect(result.headers['Access-Control-Allow-Methods']).toBe('GET,OPTIONS,POST');
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['X-Correlation-ID']).toBeDefined();
    });
  });

  describe('Logging and Metrics', () => {
    it('should log performance metrics', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const mockPrePiiResult = {
        originalText: 'Test query',
        maskedText: 'Test query',
        entitiesFound: [],
      };

      const mockKbResult = {
        output: { text: 'Test response' },
        citations: [],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session',
      };

      const mockPostPiiResult = {
        originalText: 'Test response',
        maskedText: 'Test response',
        entitiesFound: [],
      };

      mockPiiService.redactPII
        .mockResolvedValueOnce(mockPrePiiResult)
        .mockResolvedValueOnce(mockPostPiiResult);
      mockBedrockKb.askKb.mockResolvedValue(mockKbResult);

      // Act
      await handler(mockEvent, mockContext);

      // Assert
      expect(consoleSpy).toHaveBeenCalled();
      
      // Check that metrics were logged
      const logCalls = consoleSpy.mock.calls;
      const metricsLog = logCalls.find(call => {
        const logEntry = JSON.parse(call[0]);
        return logEntry.operation === 'metrics';
      });
      
      expect(metricsLog).toBeDefined();
      if (metricsLog) {
        const logEntry = JSON.parse(metricsLog[0]);
        expect(logEntry.metadata).toHaveProperty('totalLatency');
        expect(logEntry.metadata).toHaveProperty('guardrailInterventions');
        expect(logEntry.metadata).toHaveProperty('entitiesDetected');
      }

      consoleSpy.mockRestore();
    });
  });
});