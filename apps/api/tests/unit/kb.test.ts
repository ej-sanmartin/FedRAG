/**
 * Comprehensive Unit Tests for Bedrock Knowledge Base Integration
 * 
 * Tests cover advanced knowledge base scenarios, citation processing edge cases,
 * session management, and complex error handling as specified in requirements 4.1-4.5 and 8.2-8.3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveAndGenerateCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';

import {
  BedrockKnowledgeBase,
  createBedrockKnowledgeBase,
  isGuardrailIntervention,
  extractSessionId,
  formatCitationsForDisplay,
} from '../../src/bedrock.js';
import { KnowledgeBaseConfig, Citation } from '../../src/types.js';

// Mock the Bedrock client
const bedrockMock = mockClient(BedrockAgentRuntimeClient);

describe('BedrockKnowledgeBase - Advanced Scenarios', () => {
  let knowledgeBase: BedrockKnowledgeBase;
  let mockConfig: KnowledgeBaseConfig;

  beforeEach(() => {
    bedrockMock.reset();
    
    mockConfig = {
      knowledgeBaseId: 'advanced-kb-id',
      modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      generationConfiguration: {
        guardrailConfiguration: {
          guardrailId: 'advanced-guardrail-id',
          guardrailVersion: 'DRAFT',
        },
        inferenceConfig: {
          textInferenceConfig: {
            temperature: 0.1,
            topP: 0.95,
            maxTokens: 1000,
          },
        },
        promptTemplate: {
          textPromptTemplate: 'Advanced prompt: {context}\nQ: {question}\nA:',
        },
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 10,
        },
      },
    };

    knowledgeBase = new BedrockKnowledgeBase(mockConfig);
  });

  describe('Complex Citation Processing', () => {
    it('should handle citations with missing or malformed data', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Response with problematic citations [1][2].' },
        citations: [
          {
            // Missing generatedResponsePart
            retrievedReferences: [
              {
                content: { text: 'Valid content' },
                location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
              },
            ],
          },
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'valid citation',
                span: { start: 10, end: 25 },
              },
            },
            // Missing retrievedReferences
          },
          {
            generatedResponsePart: {
              textResponsePart: {
                // Missing text
                span: { start: 26, end: 35 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Another valid content' },
                // Missing location
                metadata: { title: 'Test Doc' },
              },
            ],
          },
        ],
        sessionId: 'malformed-citations-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Query with malformed citations');

      expect(result.citations).toHaveLength(3);
      
      // First citation - missing generatedResponsePart
      expect(result.citations[0].generatedResponsePart.textResponsePart.text).toBe('');
      expect(result.citations[0].generatedResponsePart.textResponsePart.span).toEqual({ start: 0, end: 0 });
      
      // Second citation - missing retrievedReferences
      expect(result.citations[1].retrievedReferences).toEqual([]);
      
      // Third citation - missing text and location
      expect(result.citations[2].generatedResponsePart.textResponsePart.text).toBe('');
      expect(result.citations[2].retrievedReferences[0].location).toBeUndefined();
    });

    it('should handle citations with deeply nested reference structures', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Complex nested citation response [1].' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'nested citation',
                span: { start: 0, end: 15 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'First level content' },
                location: { s3Location: { uri: 's3://bucket/level1.pdf' } },
                metadata: {
                  title: 'Level 1 Document',
                  author: 'Test Author',
                  nested: {
                    subsection: 'A.1.2',
                    page: 42,
                    confidence: 0.95,
                  },
                },
              },
              {
                content: { text: 'Second level content with very long text that might cause issues in processing and display' },
                location: { s3Location: { uri: 's3://bucket/level2.pdf' } },
                metadata: {
                  title: 'Level 2 Document',
                  tags: ['policy', 'compliance', 'security'],
                  references: [
                    { id: 'ref1', title: 'Referenced Doc 1' },
                    { id: 'ref2', title: 'Referenced Doc 2' },
                  ],
                },
              },
            ],
          },
        ],
        sessionId: 'nested-citations-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Complex nested query');

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].retrievedReferences).toHaveLength(2);
      expect(result.citations[0].retrievedReferences[0].metadata).toHaveProperty('nested');
      expect(result.citations[0].retrievedReferences[1].metadata).toHaveProperty('references');
    });

    it('should handle citations with special characters and unicode in URIs', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Unicode citation test [1].' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'unicode test',
                span: { start: 0, end: 12 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Content with unicode: 测试内容 🚀' },
                location: { 
                  s3Location: { 
                    uri: 's3://bucket/文档-测试/policy%20with%20spaces.pdf' 
                  } 
                },
                metadata: {
                  title: 'Unicode Document 测试',
                  description: 'Document with émojis 🎯 and spëcial chars',
                },
              },
            ],
          },
        ],
        sessionId: 'unicode-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Unicode query');

      expect(result.citations[0].retrievedReferences[0].location?.s3Location?.uri)
        .toBe('s3://bucket/文档-测试/policy%20with%20spaces.pdf');
      expect(result.citations[0].retrievedReferences[0].content.text)
        .toContain('测试内容 🚀');
    });
  });

  describe('Session Management Edge Cases', () => {
    it('should handle extremely long session IDs', async () => {
      const longSessionId = 'session-' + 'a'.repeat(1000) + '-end';
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Long session ID response' },
        citations: [],
        sessionId: longSessionId,
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Test query', longSessionId);

      expect(result.sessionId).toBe(longSessionId);
      
      const calls = bedrockMock.commandCalls(RetrieveAndGenerateCommand);
      expect(calls[0].args[0].input.sessionId).toBe(longSessionId);
    });

    it('should handle session ID with special characters', async () => {
      const specialSessionId = 'session-测试-🚀-special@chars#123';
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Special session ID response' },
        citations: [],
        sessionId: specialSessionId,
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Test query', specialSessionId);

      expect(result.sessionId).toBe(specialSessionId);
    });

    it('should generate consistent session IDs when none provided', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Generated session response' },
        citations: [],
        // No sessionId in response
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result1 = await knowledgeBase.askKb('First query');
      const result2 = await knowledgeBase.askKb('Second query');

      expect(result1.sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(result2.sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
      expect(result1.sessionId).not.toBe(result2.sessionId);
    });
  });

  describe('Performance and Latency Scenarios', () => {
    it('should handle very large responses efficiently', async () => {
      const largeText = 'Large response: ' + 'A'.repeat(50000);
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: largeText },
        citations: Array.from({ length: 50 }, (_, i) => ({
          generatedResponsePart: {
            textResponsePart: {
              text: `citation ${i}`,
              span: { start: i * 100, end: i * 100 + 10 },
            },
          },
          retrievedReferences: [
            {
              content: { text: `Reference content ${i}` },
              location: { s3Location: { uri: `s3://bucket/doc${i}.pdf` } },
            },
          ],
        })),
        sessionId: 'large-response-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const startTime = Date.now();
      const result = await knowledgeBase.askKb('Large response query');
      const endTime = Date.now();

      expect(result.output.text).toHaveLength(largeText.length);
      expect(result.citations).toHaveLength(50);
      expect(endTime - startTime).toBeLessThan(1000); // Should process within 1 second
    });

    it('should handle rapid successive calls without interference', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Concurrent response' },
        citations: [],
        sessionId: 'concurrent-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      // Make 20 concurrent calls
      const promises = Array.from({ length: 20 }, (_, i) => 
        knowledgeBase.askKb(`Concurrent query ${i}`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result.output.text).toBe('Concurrent response');
        expect(result.sessionId).toBe('concurrent-session');
      });
    });
  });

  describe('Advanced Error Scenarios', () => {
    it('should handle intermittent network failures with proper error details', async () => {
      const networkError = new Error('Network timeout');
      networkError.name = 'NetworkingError';
      (networkError as any).$metadata = { 
        httpStatusCode: 408,
        requestId: 'req-12345',
        attempts: 3,
      };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(networkError);

      await expect(knowledgeBase.askKb('Network failure query')).rejects.toMatchObject({
        name: 'NetworkingError',
        message: 'Network timeout',
        statusCode: 500, // Default for unknown errors
      });
    });

    it('should handle model-specific errors', async () => {
      const modelError = new Error('Model is currently overloaded');
      modelError.name = 'ModelTimeoutException';
      (modelError as any).$metadata = { httpStatusCode: 503 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(modelError);

      await expect(knowledgeBase.askKb('Model timeout query')).rejects.toMatchObject({
        name: 'ModelTimeoutException',
        retryable: false,
        statusCode: 500,
      });
    });

    it('should handle quota exceeded errors', async () => {
      const quotaError = new Error('Monthly quota exceeded');
      quotaError.name = 'ServiceQuotaExceededException';
      (quotaError as any).$metadata = { httpStatusCode: 402 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(quotaError);

      await expect(knowledgeBase.askKb('Quota exceeded query')).rejects.toMatchObject({
        name: 'ServiceQuotaExceededException',
        message: 'Monthly quota exceeded',
        statusCode: 500,
      });
    });

    it('should handle malformed API responses', async () => {
      const malformedResponse = {
        // Missing output field
        citations: null,
        sessionId: undefined,
        guardrailAction: 'INVALID_ACTION',
      } as any;

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(malformedResponse);

      const result = await knowledgeBase.askKb('Malformed response query');

      expect(result.output.text).toBe('');
      expect(result.citations).toEqual([]);
      expect(result.guardrailAction).toBe('NONE'); // Should default to NONE for invalid actions
      expect(result.sessionId).toMatch(/^session-\d+-[a-z0-9]+$/); // Should generate new session ID
    });
  });

  describe('Configuration Validation Edge Cases', () => {
    it('should validate nested configuration fields', () => {
      expect(() => {
        BedrockKnowledgeBase.validateConfig({
          ...mockConfig,
          generationConfiguration: {
            ...mockConfig.generationConfiguration,
            guardrailConfiguration: {
              guardrailId: 'valid-id',
              guardrailVersion: '', // Empty version
            },
          },
        });
      }).toThrow('Guardrail version is required');
    });

    it('should handle configuration with undefined nested objects', () => {
      expect(() => {
        BedrockKnowledgeBase.validateConfig({
          ...mockConfig,
          generationConfiguration: {
            ...mockConfig.generationConfiguration,
            guardrailConfiguration: undefined as any,
          },
        });
      }).toThrow('Guardrail ID is required');
    });
  });
});

describe('Insufficient Basis Template Scenarios', () => {
  let knowledgeBase: BedrockKnowledgeBase;

  beforeEach(() => {
    bedrockMock.reset();
    knowledgeBase = createBedrockKnowledgeBase(
      'insufficient-basis-kb',
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      'insufficient-basis-guardrail',
      'DRAFT'
    );
  });

  it('should handle "Insufficient basis" response with empty citations', async () => {
    const mockResponse: RetrieveAndGenerateCommandOutput = {
      output: {
        text: 'I don\'t have sufficient information in the provided context to answer this question. The following sections might contain relevant information: [policy guidelines, compliance procedures, data retention policies]',
      },
      citations: [], // Empty citations force insufficient basis
      sessionId: 'insufficient-basis-session',
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

    const result = await knowledgeBase.askKb('Very specific question not in knowledge base');

    expect(result.output.text).toContain('don\'t have sufficient information');
    expect(result.output.text).toContain('following sections might contain relevant information');
    expect(result.citations).toHaveLength(0);
    expect(result.guardrailAction).toBe('NONE');
  });

  it('should handle partial information response with limited citations', async () => {
    const mockResponse: RetrieveAndGenerateCommandOutput = {
      output: {
        text: 'Based on the limited information available, I can partially address your question. However, I don\'t have complete details about [specific aspect]. The available information suggests [partial answer] but more comprehensive information would be needed for a complete response.',
      },
      citations: [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'partial answer',
              span: { start: 150, end: 164 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Limited context from partial document' },
              location: { s3Location: { uri: 's3://bucket/partial-doc.pdf' } },
              metadata: { completeness: 'partial' },
            },
          ],
        },
      ],
      sessionId: 'partial-info-session',
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

    const result = await knowledgeBase.askKb('Question with partial information available');

    expect(result.output.text).toContain('limited information available');
    expect(result.output.text).toContain('don\'t have complete details');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].retrievedReferences[0].metadata).toHaveProperty('completeness', 'partial');
  });

  it('should handle "No relevant documents found" scenario', async () => {
    const mockResponse: RetrieveAndGenerateCommandOutput = {
      output: {
        text: 'I cannot find any relevant documents in the knowledge base that address your specific question about [topic]. You might want to try rephrasing your question or asking about related topics such as [suggested alternatives].',
      },
      citations: [],
      sessionId: 'no-documents-session',
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

    const result = await knowledgeBase.askKb('Question about topic not in knowledge base');

    expect(result.output.text).toContain('cannot find any relevant documents');
    expect(result.output.text).toContain('try rephrasing your question');
    expect(result.citations).toHaveLength(0);
  });

  it('should handle context too broad scenario', async () => {
    const mockResponse: RetrieveAndGenerateCommandOutput = {
      output: {
        text: 'Your question is quite broad and covers multiple areas. While I found some relevant information [1][2], a more specific question would help me provide a more targeted response. Consider asking about specific aspects such as [specific areas].',
      },
      citations: [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'some relevant information',
              span: { start: 85, end: 109 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Broad topic overview document' },
              location: { s3Location: { uri: 's3://bucket/overview.pdf' } },
            },
          ],
        },
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'some relevant information',
              span: { start: 85, end: 109 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'General policy document' },
              location: { s3Location: { uri: 's3://bucket/general-policy.pdf' } },
            },
          ],
        },
      ],
      sessionId: 'broad-context-session',
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

    const result = await knowledgeBase.askKb('Very broad question about everything');

    expect(result.output.text).toContain('question is quite broad');
    expect(result.output.text).toContain('more specific question would help');
    expect(result.citations).toHaveLength(2);
  });
});

describe('Utility Functions - Advanced Tests', () => {
  describe('formatCitationsForDisplay edge cases', () => {
    it('should handle citations with very long URIs', async () => {
      const longUri = 's3://very-long-bucket-name-with-many-segments/' + 'a'.repeat(500) + '.pdf';
      const citations: Citation[] = [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'citation with long URI',
              span: { start: 0, end: 22 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Content' },
              location: { s3Location: { uri: longUri } },
            },
          ],
        },
      ];

      const formatted = formatCitationsForDisplay(citations);
      
      expect(formatted).toContain('[1] 1 reference(s):');
      expect(formatted).toContain(longUri);
    });

    it('should handle citations with mixed reference types', async () => {
      const citations: Citation[] = [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'mixed references',
              span: { start: 0, end: 16 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'S3 content' },
              location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
            },
            {
              content: { text: 'No location content' },
              // No location
            },
            {
              content: { text: 'Empty location content' },
              location: {}, // Empty location object
            },
          ],
        },
      ];

      const formatted = formatCitationsForDisplay(citations);
      
      expect(formatted).toContain('[1] 3 reference(s): s3://bucket/doc1.pdf, Unknown source, Unknown source');
    });

    it('should handle null and undefined citation data gracefully', async () => {
      const citations: Citation[] = [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'null data test',
              span: { start: 0, end: 14 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Valid content' },
              location: { s3Location: { uri: null as any } }, // Null URI
            },
            {
              content: { text: null as any }, // Null content
              location: { s3Location: { uri: 's3://bucket/doc.pdf' } },
            },
          ],
        },
      ];

      const formatted = formatCitationsForDisplay(citations);
      
      expect(formatted).toContain('[1] 2 reference(s):');
      expect(formatted).toContain('Unknown source');
    });
  });

  describe('isGuardrailIntervention comprehensive tests', () => {
    it('should identify various guardrail intervention patterns', () => {
      const testCases = [
        {
          error: { name: 'GuardrailIntervention', message: 'Blocked', statusCode: 400 },
          expected: true,
        },
        {
          error: { name: 'ValidationException', message: 'Content blocked by guardrail', statusCode: 400 },
          expected: true,
        },
        {
          error: { name: 'UnknownError', message: 'GUARDRAIL violation detected', statusCode: 400 },
          expected: true,
        },
        {
          error: { name: 'ServiceError', message: 'Content policy violation', statusCode: 400 },
          expected: true,
        },
        {
          error: { name: 'ThrottlingException', message: 'Rate limit exceeded', statusCode: 429 },
          expected: false,
        },
        {
          error: { name: 'ValidationException', message: 'Invalid parameter', statusCode: 400 },
          expected: false,
        },
      ];

      testCases.forEach(({ error, expected }) => {
        expect(isGuardrailIntervention(error)).toBe(expected);
      });
    });
  });
});