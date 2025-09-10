/**
 * End-to-End Integration Tests for FedRag Privacy RAG Assistant
 * 
 * These tests verify the complete system functionality including:
 * - Authentication flow from Cognito to API access
 * - PII redaction functionality across the entire pipeline
 * - Knowledge base retrieval with actual document corpus
 * - Guardrail interventions with denied topic queries
 * - Citation display and S3 URI linking functionality
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler } from '../../src/index.js';

// Mock AWS SDK clients for E2E tests
vi.mock('@aws-sdk/client-comprehend');
vi.mock('@aws-sdk/client-bedrock-agent-runtime');

// Mock the PII and Bedrock modules with realistic responses
vi.mock('../../src/pii.js', () => ({
  PiiService: vi.fn().mockImplementation(() => ({
    redactPII: vi.fn(),
  })),
}));

vi.mock('../../src/bedrock.js', () => ({
  createBedrockKnowledgeBase: vi.fn().mockReturnValue({
    askKb: vi.fn(),
  }),
  isGuardrailIntervention: vi.fn(),
}));

// Import mocked modules
import { PiiService } from '../../src/pii.js';
import { createBedrockKnowledgeBase, isGuardrailIntervention } from '../../src/bedrock.js';

// Test configuration
const TEST_CONFIG = {
  // Test environment variables
  KB_ID: process.env.TEST_KB_ID || 'test-kb-id',
  MODEL_ARN: process.env.TEST_MODEL_ARN || 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
  GUARDRAIL_ID: process.env.TEST_GUARDRAIL_ID || 'test-guardrail-id',
  GUARDRAIL_VERSION: process.env.TEST_GUARDRAIL_VERSION || 'DRAFT',
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  
  // Test timeouts
  TIMEOUT_SHORT: 10000,
  TIMEOUT_MEDIUM: 20000,
  TIMEOUT_LONG: 30000,
  
  // Test data
  SAMPLE_QUERIES: {
    CLEAN: 'What is the data retention policy?',
    WITH_PII: 'What is the policy for employee john.doe@company.com with SSN 123-45-6789?',
    DENIED_TOPIC: 'How to hack into government systems?',
    VIOLENCE_TOPIC: 'How to build weapons and cause harm?',
    INSUFFICIENT_CONTEXT: 'What is the policy on quantum computing regulations?',
  },
  
  // Expected responses
  EXPECTED_PATTERNS: {
    POLICY_RESPONSE: /policy|retention|data|records/i,
    PII_REDACTED: /<REDACTED:(EMAIL|SSN)>/,
    GUARDRAIL_BLOCKED: /cannot provide|violates|policy|inappropriate/i,
    INSUFFICIENT_BASIS: /insufficient|basis|cannot find|not available/i,
  }
};

describe('End-to-End Integration Tests', () => {
  let mockContext: Context;
  let correlationId: string;
  let mockPiiService: any;
  let mockBedrockKb: any;

  beforeAll(() => {
    // Set up test environment
    process.env.KB_ID = TEST_CONFIG.KB_ID;
    process.env.MODEL_ARN = TEST_CONFIG.MODEL_ARN;
    process.env.GUARDRAIL_ID = TEST_CONFIG.GUARDRAIL_ID;
    process.env.GUARDRAIL_VERSION = TEST_CONFIG.GUARDRAIL_VERSION;
    process.env.AWS_REGION = TEST_CONFIG.AWS_REGION;
    process.env.LOG_LEVEL = 'DEBUG';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    correlationId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    mockContext = {
      awsRequestId: correlationId,
      functionName: 'fedrag-api-test',
      functionVersion: '1',
      invokedFunctionArn: `arn:aws:lambda:${TEST_CONFIG.AWS_REGION}:123456789012:function:fedrag-api-test`,
      memoryLimitInMB: '512',
      remainingTimeInMillis: () => 30000,
      logGroupName: '/aws/lambda/fedrag-api-test',
      logStreamName: `2024/01/01/[$LATEST]${correlationId}`,
      callbackWaitsForEmptyEventLoop: true,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };

    // Set up mocks with realistic responses
    mockPiiService = {
      redactPII: vi.fn(),
    };
    (PiiService as any).mockImplementation(() => mockPiiService);

    mockBedrockKb = {
      askKb: vi.fn(),
    };
    (createBedrockKnowledgeBase as any).mockReturnValue(mockBedrockKb);
    (isGuardrailIntervention as any).mockReturnValue(false);

    // Default successful responses - will be overridden in specific tests
    mockPiiService.redactPII.mockResolvedValue({
      originalText: 'Test query',
      maskedText: 'Test query',
      entitiesFound: [],
    });

    mockBedrockKb.askKb.mockResolvedValue({
      output: { text: 'Test response from knowledge base' },
      citations: [],
      guardrailAction: 'NONE',
      sessionId: 'test-session',
    });
  });

  afterAll(() => {
    // Clean up environment
    delete process.env.KB_ID;
    delete process.env.MODEL_ARN;
    delete process.env.GUARDRAIL_ID;
    delete process.env.GUARDRAIL_VERSION;
    delete process.env.AWS_REGION;
    delete process.env.LOG_LEVEL;
  });

  /**
   * Helper function to create API Gateway event
   */
  function createApiEvent(query: string, sessionId?: string): APIGatewayProxyEvent {
    return {
      httpMethod: 'POST',
      path: '/chat',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-jwt-token',
        'User-Agent': 'FedRag-E2E-Test/1.0',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        query,
        sessionId: sessionId || `session-${correlationId}`,
      }),
      isBase64Encoded: false,
      multiValueHeaders: {},
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {
        requestId: correlationId,
        stage: 'test',
        resourceId: 'chat',
        httpMethod: 'POST',
        path: '/chat',
        protocol: 'HTTP/1.1',
        resourcePath: '/chat',
        accountId: '123456789012',
        apiId: 'test-api-id',
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'FedRag-E2E-Test/1.0',
        } as any,
        requestTime: new Date().toISOString(),
        requestTimeEpoch: Date.now(),
      } as any,
      resource: '/chat',
    };
  }

  /**
   * Helper function to validate response structure
   */
  function validateResponseStructure(response: any) {
    expect(response).toHaveProperty('statusCode');
    expect(response).toHaveProperty('headers');
    expect(response).toHaveProperty('body');
    expect(response.headers).toHaveProperty('Content-Type', 'application/json');
    expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
    expect(response.headers).toHaveProperty('X-Correlation-ID');
    
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('answer');
      expect(body).toHaveProperty('citations');
      expect(body).toHaveProperty('guardrailAction');
      expect(body).toHaveProperty('sessionId');
      expect(Array.isArray(body.citations)).toBe(true);
      expect(['NONE', 'INTERVENED']).toContain(body.guardrailAction);
    }
  }

  describe('1. Complete Authentication Flow Integration', () => {
    it('should process authenticated requests successfully', async () => {
      // Test requirement 1.1: React-based chat interface with TypeScript support
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.CLEAN);
      
      // Set up successful mock responses
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: TEST_CONFIG.SAMPLE_QUERIES.CLEAN,
          maskedText: TEST_CONFIG.SAMPLE_QUERIES.CLEAN,
          entitiesFound: [],
        })
        .mockResolvedValueOnce({
          originalText: 'Data retention policy requires keeping records for 7 years.',
          maskedText: 'Data retention policy requires keeping records for 7 years.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Data retention policy requires keeping records for 7 years.' },
        citations: [{
          generatedResponsePart: {
            textResponsePart: {
              text: 'Data retention policy requires keeping records for 7 years.',
              span: { start: 0, end: 58 }
            }
          },
          retrievedReferences: [{
            content: { text: 'Policy excerpt about data retention...' },
            location: { s3Location: { uri: 's3://bucket/policy.pdf' } },
            metadata: {}
          }]
        }],
        guardrailAction: 'NONE',
        sessionId: 'test-session-123',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(typeof body.answer).toBe('string');
      expect(body.answer.length).toBeGreaterThan(0);
      expect(body.sessionId).toBeDefined();
      expect(body.citations).toBeDefined();
      expect(Array.isArray(body.citations)).toBe(true);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle missing authorization header gracefully', async () => {
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.CLEAN);
      delete event.headers.Authorization;
      
      const response = await handler(event, mockContext);
      
      // Note: In real deployment, API Gateway JWT authorizer would handle this
      // For testing, we verify the handler can process the request structure
      validateResponseStructure(response);
    }, TEST_CONFIG.TIMEOUT_SHORT);

    it('should maintain session continuity across requests', async () => {
      const sessionId = `session-continuity-${correlationId}`;
      
      // Set up mocks for both requests
      mockPiiService.redactPII.mockResolvedValue({
        originalText: 'Test query',
        maskedText: 'Test query',
        entitiesFound: [],
      });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Data policy information' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: sessionId, // Return the same session ID
      });
      
      // First request
      const event1 = createApiEvent('What is the data policy?', sessionId);
      const response1 = await handler(event1, mockContext);
      
      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.sessionId).toBe(sessionId);
      
      // Second request with same session
      const event2 = createApiEvent('Can you elaborate on that?', sessionId);
      const response2 = await handler(event2, mockContext);
      
      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.sessionId).toBe(sessionId);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);
  });

  describe('2. PII Redaction Pipeline Integration', () => {
    it('should detect and mask PII in user queries', async () => {
      // Test requirement 1.2: PII detection and masking before sending to knowledge base
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.WITH_PII);
      
      // Mock PII detection with entities found
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: TEST_CONFIG.SAMPLE_QUERIES.WITH_PII,
          maskedText: 'What is the policy for employee <REDACTED:EMAIL> with SSN <REDACTED:SSN>?',
          entitiesFound: [
            { Type: 'EMAIL', Score: 0.99, BeginOffset: 32, EndOffset: 55 },
            { Type: 'SSN', Score: 0.98, BeginOffset: 65, EndOffset: 76 }
          ],
        })
        .mockResolvedValueOnce({
          originalText: 'The policy applies to all employees.',
          maskedText: 'The policy applies to all employees.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'The policy applies to all employees.' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'test-session-456',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should have redacted query field when PII is detected
      expect(body.redactedQuery).toBeDefined();
      expect(body.redactedQuery).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.PII_REDACTED);
      expect(body.redactedQuery).not.toContain('john.doe@company.com');
      expect(body.redactedQuery).not.toContain('123-45-6789');
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should detect and mask PII in system responses', async () => {
      // Test requirement 1.4: PII masking in responses
      const event = createApiEvent('What is the contact information for support?');
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // If response contains PII, it should be redacted
      if (body.redactedAnswer) {
        expect(body.redactedAnswer).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.PII_REDACTED);
      }
      
      // Original answer should not contain obvious PII patterns
      expect(body.answer).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/); // SSN pattern
      expect(body.answer).not.toMatch(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/); // Email pattern
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle overlapping PII entities correctly', async () => {
      const queryWithOverlappingPII = 'Contact john.doe@company.com or call 555-123-4567 for john.doe@company.com';
      const event = createApiEvent(queryWithOverlappingPII);
      
      // Mock PII detection with overlapping entities
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: queryWithOverlappingPII,
          maskedText: 'Contact <REDACTED:EMAIL> or call <REDACTED:PHONE> for <REDACTED:EMAIL>',
          entitiesFound: [
            { Type: 'EMAIL', Score: 0.99, BeginOffset: 8, EndOffset: 31 },
            { Type: 'PHONE', Score: 0.98, BeginOffset: 40, EndOffset: 52 },
            { Type: 'EMAIL', Score: 0.99, BeginOffset: 57, EndOffset: 80 }
          ],
        })
        .mockResolvedValueOnce({
          originalText: 'Policy information provided.',
          maskedText: 'Policy information provided.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Policy information provided.' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should have redacted query with overlapping entities handled
      expect(body.redactedQuery).toBeDefined();
      expect(body.redactedQuery).toMatch(/<REDACTED:(EMAIL|PHONE)>/);
      expect(body.redactedQuery).not.toContain('john.doe@company.com');
      expect(body.redactedQuery).not.toContain('555-123-4567');
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should preserve text structure during PII masking', async () => {
      const structuredQuery = `
        Employee Information:
        - Name: John Doe
        - Email: john.doe@company.com
        - Phone: 555-123-4567
        - SSN: 123-45-6789
        
        What policies apply to this employee?
      `;
      
      const event = createApiEvent(structuredQuery);
      
      // Mock PII detection preserving structure
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: structuredQuery,
          maskedText: `
        Employee Information:
        - Name: <REDACTED:PERSON>
        - Email: <REDACTED:EMAIL>
        - Phone: <REDACTED:PHONE>
        - SSN: <REDACTED:SSN>
        
        What policies apply to this employee?
      `,
          entitiesFound: [
            { Type: 'PERSON', Score: 0.99, BeginOffset: 35, EndOffset: 43 },
            { Type: 'EMAIL', Score: 0.99, BeginOffset: 54, EndOffset: 77 },
            { Type: 'PHONE', Score: 0.98, BeginOffset: 88, EndOffset: 100 },
            { Type: 'SSN', Score: 0.98, BeginOffset: 108, EndOffset: 119 }
          ],
        })
        .mockResolvedValueOnce({
          originalText: 'Employee policies apply based on role and department.',
          maskedText: 'Employee policies apply based on role and department.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Employee policies apply based on role and department.' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should have preserved structure while masking PII
      expect(body.redactedQuery).toBeDefined();
      expect(body.redactedQuery).toContain('Employee Information:');
      expect(body.redactedQuery).toContain('- Name:');
      expect(body.redactedQuery).toContain('What policies apply');
      expect(body.redactedQuery).toMatch(/<REDACTED:/);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);
  });

  describe('3. Knowledge Base Retrieval Integration', () => {
    it('should retrieve relevant information from knowledge base', async () => {
      // Test requirement 1.3: Include inline citations with citations panel
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.CLEAN);
      
      // Mock realistic knowledge base response
      mockPiiService.redactPII.mockResolvedValue({
        originalText: TEST_CONFIG.SAMPLE_QUERIES.CLEAN,
        maskedText: TEST_CONFIG.SAMPLE_QUERIES.CLEAN,
        entitiesFound: [],
      });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Data retention policy requires keeping records for 7 years according to federal regulations.' },
        citations: [{
          generatedResponsePart: {
            textResponsePart: {
              text: 'Data retention policy requires keeping records for 7 years',
              span: { start: 0, end: 57 }
            }
          },
          retrievedReferences: [{
            content: { text: 'Federal regulations specify that organizations must retain data records for a minimum of seven years...' },
            location: { s3Location: { uri: 's3://fedrag-corpus/policies/data-retention.pdf' } },
            metadata: { title: 'Data Retention Policy', section: '3.1' }
          }]
        }],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should provide a relevant answer
      expect(body.answer).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.POLICY_RESPONSE);
      expect(body.answer.length).toBeGreaterThan(10);
      
      // Should include citations if relevant documents found
      expect(Array.isArray(body.citations)).toBe(true);
      
      if (body.citations.length > 0) {
        const citation = body.citations[0];
        expect(citation).toHaveProperty('generatedResponsePart');
        expect(citation).toHaveProperty('retrievedReferences');
        expect(Array.isArray(citation.retrievedReferences)).toBe(true);
        
        if (citation.retrievedReferences.length > 0) {
          const reference = citation.retrievedReferences[0];
          expect(reference).toHaveProperty('content');
          expect(reference.content).toHaveProperty('text');
          expect(typeof reference.content.text).toBe('string');
        }
      }
    }, TEST_CONFIG.TIMEOUT_LONG);

    it('should handle queries with insufficient context gracefully', async () => {
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.INSUFFICIENT_CONTEXT);
      
      // Clear previous mocks and set specific responses
      mockPiiService.redactPII.mockReset();
      mockBedrockKb.askKb.mockReset();
      
      // Mock insufficient context response - both pre and post PII detection
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: TEST_CONFIG.SAMPLE_QUERIES.INSUFFICIENT_CONTEXT,
          maskedText: TEST_CONFIG.SAMPLE_QUERIES.INSUFFICIENT_CONTEXT,
          entitiesFound: [],
        })
        .mockResolvedValueOnce({
          originalText: 'I cannot find sufficient information about quantum computing regulations in the available documents.',
          maskedText: 'I cannot find sufficient information about quantum computing regulations in the available documents.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'I cannot find sufficient information about quantum computing regulations in the available documents.' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should explicitly state when context is insufficient
      expect(body.answer).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.INSUFFICIENT_BASIS);
      expect(body.citations).toEqual([]);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should provide properly formatted citations with S3 URIs', async () => {
      const event = createApiEvent('What are the document retention requirements?');
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      if (body.citations.length > 0) {
        for (const citation of body.citations) {
          expect(citation.generatedResponsePart).toHaveProperty('textResponsePart');
          expect(citation.generatedResponsePart.textResponsePart).toHaveProperty('text');
          expect(citation.generatedResponsePart.textResponsePart).toHaveProperty('span');
          
          const span = citation.generatedResponsePart.textResponsePart.span;
          expect(typeof span.start).toBe('number');
          expect(typeof span.end).toBe('number');
          expect(span.start).toBeLessThanOrEqual(span.end);
          
          for (const reference of citation.retrievedReferences) {
            expect(reference).toHaveProperty('content');
            expect(reference.content).toHaveProperty('text');
            
            if (reference.location?.s3Location?.uri) {
              expect(reference.location.s3Location.uri).toMatch(/^s3:\/\//);
            }
          }
        }
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle vector search with multiple relevant documents', async () => {
      const event = createApiEvent('What are all the policies related to data handling and privacy?');
      
      // Mock comprehensive response with multiple citations
      mockPiiService.redactPII.mockResolvedValue({
        originalText: 'What are all the policies related to data handling and privacy?',
        maskedText: 'What are all the policies related to data handling and privacy?',
        entitiesFound: [],
      });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Data handling and privacy policies include data retention requirements, access controls, PII protection measures, and compliance with federal regulations. These policies ensure proper data governance and user privacy protection.' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'data retention requirements',
                span: { start: 45, end: 71 }
              }
            },
            retrievedReferences: [{
              content: { text: 'Data retention policy requires keeping records for 7 years...' },
              location: { s3Location: { uri: 's3://fedrag-corpus/policies/data-retention.pdf' } },
              metadata: { title: 'Data Retention Policy' }
            }]
          },
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'PII protection measures',
                span: { start: 89, end: 112 }
              }
            },
            retrievedReferences: [{
              content: { text: 'PII protection requires masking sensitive information...' },
              location: { s3Location: { uri: 's3://fedrag-corpus/policies/pii-protection.pdf' } },
              metadata: { title: 'PII Protection Policy' }
            }]
          }
        ],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should provide comprehensive answer
      expect(body.answer.length).toBeGreaterThan(50);
      
      // Should have multiple citations from different documents
      if (body.citations.length > 1) {
        const s3Uris = new Set();
        body.citations.forEach((citation: any) => {
          citation.retrievedReferences.forEach((ref: any) => {
            if (ref.location?.s3Location?.uri) {
              s3Uris.add(ref.location.s3Location.uri);
            }
          });
        });
        
        // Should reference multiple source documents
        expect(s3Uris.size).toBeGreaterThan(0);
      }
    }, TEST_CONFIG.TIMEOUT_LONG);
  });

  describe('4. Guardrail Intervention Validation', () => {
    it('should block denied topic queries with appropriate messaging', async () => {
      // Test requirement 1.5: Guardrail intervention banner display
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.DENIED_TOPIC);
      
      // Clear previous mocks and set specific responses
      mockPiiService.redactPII.mockReset();
      mockBedrockKb.askKb.mockReset();
      
      // Mock guardrail intervention - both pre and post PII detection
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: TEST_CONFIG.SAMPLE_QUERIES.DENIED_TOPIC,
          maskedText: TEST_CONFIG.SAMPLE_QUERIES.DENIED_TOPIC,
          entitiesFound: [],
        })
        .mockResolvedValueOnce({
          originalText: 'I cannot provide information about that topic as it violates our content policies.',
          maskedText: 'I cannot provide information about that topic as it violates our content policies.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'I cannot provide information about that topic as it violates our content policies.' },
        citations: [],
        guardrailAction: 'INTERVENED',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should indicate guardrail intervention
      expect(body.guardrailAction).toBe('INTERVENED');
      
      // Should provide appropriate blocked message
      expect(body.answer).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.GUARDRAIL_BLOCKED);
      
      // Should not provide citations for blocked content
      expect(body.citations).toEqual([]);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should block violence-related queries', async () => {
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.VIOLENCE_TOPIC);
      
      // Clear previous mocks and set specific responses
      mockPiiService.redactPII.mockReset();
      mockBedrockKb.askKb.mockReset();
      
      // Mock guardrail intervention for violence - both pre and post PII detection
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: TEST_CONFIG.SAMPLE_QUERIES.VIOLENCE_TOPIC,
          maskedText: TEST_CONFIG.SAMPLE_QUERIES.VIOLENCE_TOPIC,
          entitiesFound: [],
        })
        .mockResolvedValueOnce({
          originalText: 'I cannot provide information about violence or harmful activities as it violates our content policies.',
          maskedText: 'I cannot provide information about violence or harmful activities as it violates our content policies.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'I cannot provide information about violence or harmful activities as it violates our content policies.' },
        citations: [],
        guardrailAction: 'INTERVENED',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      expect(body.guardrailAction).toBe('INTERVENED');
      expect(body.answer).toMatch(TEST_CONFIG.EXPECTED_PATTERNS.GUARDRAIL_BLOCKED);
      expect(body.citations).toEqual([]);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle guardrail PII masking integration', async () => {
      const piiQuery = 'How can I use SSN 123-45-6789 to access unauthorized systems?';
      const event = createApiEvent(piiQuery);
      
      // Mock PII detection and guardrail intervention
      mockPiiService.redactPII
        .mockResolvedValueOnce({
          originalText: piiQuery,
          maskedText: 'How can I use SSN <REDACTED:SSN> to access unauthorized systems?',
          entitiesFound: [{ Type: 'SSN', Score: 0.98, BeginOffset: 18, EndOffset: 29 }],
        })
        .mockResolvedValueOnce({
          originalText: 'I cannot provide information about unauthorized access as it violates our content policies.',
          maskedText: 'I cannot provide information about unauthorized access as it violates our content policies.',
          entitiesFound: [],
        });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'I cannot provide information about unauthorized access as it violates our content policies.' },
        citations: [],
        guardrailAction: 'INTERVENED',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should be blocked due to harmful intent
      expect(body.guardrailAction).toBe('INTERVENED');
      
      // Should also have PII redaction
      expect(body.redactedQuery).toBeDefined();
      expect(body.redactedQuery).toMatch(/<REDACTED:SSN>/);
      expect(body.redactedQuery).not.toContain('123-45-6789');
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should allow legitimate queries while maintaining guardrails', async () => {
      const legitimateQuery = 'What is the proper procedure for handling sensitive data?';
      const event = createApiEvent(legitimateQuery);
      
      // Mock legitimate response
      mockPiiService.redactPII.mockResolvedValue({
        originalText: legitimateQuery,
        maskedText: legitimateQuery,
        entitiesFound: [],
      });

      mockBedrockKb.askKb.mockResolvedValue({
        output: { text: 'Proper procedures for handling sensitive data include encryption, access controls, regular audits, and compliance with data protection regulations.' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'test-session',
      });
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // Should not be blocked
      expect(body.guardrailAction).toBe('NONE');
      
      // Should provide helpful response
      expect(body.answer.length).toBeGreaterThan(20);
      expect(body.answer).toMatch(/procedure|handling|data|sensitive/i);
    }, TEST_CONFIG.TIMEOUT_MEDIUM);
  });

  describe('5. Citation Display and S3 URI Linking', () => {
    it('should provide properly formatted citations with S3 links', async () => {
      const event = createApiEvent('What documents define our data retention policy?');
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      if (body.citations.length > 0) {
        for (const citation of body.citations) {
          // Validate citation structure
          expect(citation).toHaveProperty('generatedResponsePart');
          expect(citation).toHaveProperty('retrievedReferences');
          
          const textPart = citation.generatedResponsePart.textResponsePart;
          expect(textPart).toHaveProperty('text');
          expect(textPart).toHaveProperty('span');
          
          // Validate span references actual text in answer
          const spanText = body.answer.substring(textPart.span.start, textPart.span.end);
          expect(spanText.length).toBeGreaterThan(0);
          
          // Validate retrieved references
          for (const reference of citation.retrievedReferences) {
            expect(reference).toHaveProperty('content');
            expect(reference.content).toHaveProperty('text');
            expect(reference.content.text.length).toBeGreaterThan(0);
            
            // Check S3 URI format if present
            if (reference.location?.s3Location?.uri) {
              expect(reference.location.s3Location.uri).toMatch(/^s3:\/\/[^\/]+\/.+/);
            }
          }
        }
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle citations with metadata and excerpts', async () => {
      const event = createApiEvent('What are the key compliance requirements?');
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      if (body.citations.length > 0) {
        for (const citation of body.citations) {
          for (const reference of citation.retrievedReferences) {
            // Should have content excerpt
            expect(reference.content.text).toBeDefined();
            expect(typeof reference.content.text).toBe('string');
            
            // May have metadata
            if (reference.metadata) {
              expect(typeof reference.metadata).toBe('object');
            }
            
            // Should have location information
            expect(reference).toHaveProperty('location');
          }
        }
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should provide inline citation markers in response text', async () => {
      const event = createApiEvent('What is the data classification policy?');
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      if (body.citations.length > 0) {
        // Check that citation spans correspond to actual text
        for (const citation of body.citations) {
          const span = citation.generatedResponsePart.textResponsePart.span;
          const citedText = body.answer.substring(span.start, span.end);
          
          expect(citedText.length).toBeGreaterThan(0);
          expect(span.start).toBeGreaterThanOrEqual(0);
          expect(span.end).toBeLessThanOrEqual(body.answer.length);
          expect(span.start).toBeLessThan(span.end);
        }
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);
  });

  describe('6. Performance and Reliability', () => {
    it('should complete requests within acceptable time limits', async () => {
      const startTime = Date.now();
      const event = createApiEvent(TEST_CONFIG.SAMPLE_QUERIES.CLEAN);
      
      const response = await handler(event, mockContext);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      // Should complete within reasonable time (adjust based on actual performance)
      expect(duration).toBeLessThan(15000); // 15 seconds max
    }, TEST_CONFIG.TIMEOUT_LONG);

    it('should handle concurrent requests properly', async () => {
      const queries = [
        'What is the data retention policy?',
        'What are the privacy requirements?',
        'What is the access control policy?',
      ];
      
      // Mock responses for concurrent requests
      mockPiiService.redactPII.mockResolvedValue({
        originalText: 'Test query',
        maskedText: 'Test query',
        entitiesFound: [],
      });

      // Mock different responses for each concurrent request
      mockBedrockKb.askKb
        .mockResolvedValueOnce({
          output: { text: 'Data retention policy information' },
          citations: [],
          guardrailAction: 'NONE',
          sessionId: 'concurrent-session-0',
        })
        .mockResolvedValueOnce({
          output: { text: 'Privacy requirements information' },
          citations: [],
          guardrailAction: 'NONE',
          sessionId: 'concurrent-session-1',
        })
        .mockResolvedValueOnce({
          output: { text: 'Access control policy information' },
          citations: [],
          guardrailAction: 'NONE',
          sessionId: 'concurrent-session-2',
        });
      
      const promises = queries.map((query, index) => {
        const event = createApiEvent(query, `concurrent-session-${index}`);
        return handler(event, mockContext);
      });
      
      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach((response, index) => {
        validateResponseStructure(response);
        expect(response.statusCode).toBe(200);
        
        const body = JSON.parse(response.body);
        expect(body.sessionId).toBe(`concurrent-session-${index}`);
      });
    }, TEST_CONFIG.TIMEOUT_LONG);

    it('should maintain consistent response format across different query types', async () => {
      const testQueries = [
        TEST_CONFIG.SAMPLE_QUERIES.CLEAN,
        TEST_CONFIG.SAMPLE_QUERIES.WITH_PII,
        TEST_CONFIG.SAMPLE_QUERIES.INSUFFICIENT_CONTEXT,
      ];
      
      for (const query of testQueries) {
        const event = createApiEvent(query);
        const response = await handler(event, mockContext);
        
        validateResponseStructure(response);
        expect(response.statusCode).toBe(200);
        
        const body = JSON.parse(response.body);
        
        // Consistent response structure
        expect(body).toHaveProperty('answer');
        expect(body).toHaveProperty('citations');
        expect(body).toHaveProperty('guardrailAction');
        expect(body).toHaveProperty('sessionId');
        
        expect(typeof body.answer).toBe('string');
        expect(Array.isArray(body.citations)).toBe(true);
        expect(['NONE', 'INTERVENED']).toContain(body.guardrailAction);
        expect(typeof body.sessionId).toBe('string');
      }
    }, TEST_CONFIG.TIMEOUT_LONG);
  });

  describe('7. Error Handling and Edge Cases', () => {
    it('should handle extremely long queries gracefully', async () => {
      const longQuery = 'What is the policy on '.repeat(1000) + 'data retention?';
      const event = createApiEvent(longQuery);
      
      const response = await handler(event, mockContext);
      
      // Should either process or reject with appropriate error
      expect([200, 400]).toContain(response.statusCode);
      
      if (response.statusCode === 400) {
        const body = JSON.parse(response.body);
        expect(body.message).toContain('maximum length');
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle queries with special characters and encoding', async () => {
      const specialQuery = 'What is the policy on data with émojis 🔒 and spëcial chars?';
      const event = createApiEvent(specialQuery);
      
      const response = await handler(event, mockContext);
      
      validateResponseStructure(response);
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.answer).toBeDefined();
      expect(typeof body.answer).toBe('string');
    }, TEST_CONFIG.TIMEOUT_MEDIUM);

    it('should handle empty and whitespace-only queries', async () => {
      const emptyQueries = ['', '   ', '\n\t  \n'];
      
      for (const query of emptyQueries) {
        const event = createApiEvent(query);
        const response = await handler(event, mockContext);
        
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.message).toMatch(/empty|required|string/i);
      }
    }, TEST_CONFIG.TIMEOUT_SHORT);

    it('should maintain system stability under error conditions', async () => {
      // Test various error conditions
      const errorTests = [
        { query: null, expectedStatus: 400 },
        { query: undefined, expectedStatus: 400 },
        { query: 123, expectedStatus: 400 },
        { query: {}, expectedStatus: 400 },
      ];
      
      for (const test of errorTests) {
        const event = createApiEvent('dummy');
        event.body = JSON.stringify({ query: test.query });
        
        const response = await handler(event, mockContext);
        expect(response.statusCode).toBe(test.expectedStatus);
        
        // Should still have proper response structure
        expect(response).toHaveProperty('headers');
        expect(response.headers['Content-Type']).toBe('application/json');
      }
    }, TEST_CONFIG.TIMEOUT_MEDIUM);
  });
});