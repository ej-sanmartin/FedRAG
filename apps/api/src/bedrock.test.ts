/**
 * Unit tests for Bedrock Knowledge Base integration
 * 
 * Tests cover knowledge base calls, guardrail behavior simulation,
 * citation processing, session management, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
  RetrieveCommand,
  RetrieveAndGenerateCommandOutput,
  RetrieveCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';

import {
  BedrockKnowledgeBase,
  createBedrockKnowledgeBase,
  isGuardrailIntervention,
  extractSessionId,
  formatCitationsForDisplay,
} from './bedrock.js';
import { KnowledgeBaseConfig, Citation } from './types.js';

// Mock the Bedrock client
const bedrockMock = mockClient(BedrockAgentRuntimeClient);

describe('BedrockKnowledgeBase', () => {
  let knowledgeBase: BedrockKnowledgeBase;
  let mockConfig: KnowledgeBaseConfig;

  beforeEach(() => {
    bedrockMock.reset();
    
    mockConfig = {
      knowledgeBaseId: 'test-kb-id',
      modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      generationConfiguration: {
        guardrailConfiguration: {
          guardrailId: 'test-guardrail-id',
          guardrailVersion: '1',
        },
        inferenceConfig: {
          textInferenceConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxTokens: 800,
          },
        },
        promptTemplate: {
          textPromptTemplate: 'Test prompt template: {context}\nQuestion: {question}\nAnswer:',
        },
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 6,
        },
      },
    };

    knowledgeBase = new BedrockKnowledgeBase(mockConfig);
  });

  describe('constructor and configuration', () => {
    it('should create instance with valid configuration', () => {
      expect(knowledgeBase).toBeInstanceOf(BedrockKnowledgeBase);
    });

    it('should validate required configuration fields', () => {
      expect(() => {
        BedrockKnowledgeBase.validateConfig({
          ...mockConfig,
          knowledgeBaseId: '',
        });
      }).toThrow('Knowledge base ID is required');

      expect(() => {
        BedrockKnowledgeBase.validateConfig({
          ...mockConfig,
          modelArn: '',
        });
      }).toThrow('Model ARN is required');

      expect(() => {
        BedrockKnowledgeBase.validateConfig({
          ...mockConfig,
          generationConfiguration: {
            ...mockConfig.generationConfiguration,
            guardrailConfiguration: {
              ...mockConfig.generationConfiguration.guardrailConfiguration,
              guardrailId: '',
            },
          },
        });
      }).toThrow('Guardrail ID is required');
    });
  });

  describe('askKb method', () => {
    it('should successfully query knowledge base and return formatted response', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: {
          text: 'This is a test response with citations [1].',
        },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'test response',
                span: { start: 10, end: 23 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Source document content' },
                location: {
                  s3Location: { uri: 's3://test-bucket/doc1.pdf' },
                },
                metadata: { title: 'Test Document' },
              },
            ],
          },
        ],
        sessionId: 'test-session-123',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('What is the policy on testing?');

      expect(result.output.text).toBe('This is a test response with citations [1].');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].retrievedReferences[0].location?.s3Location?.uri).toBe('s3://test-bucket/doc1.pdf');
      expect(result.guardrailAction).toBe('NONE');
      expect(result.sessionId).toBe('test-session-123');
    });

    it('should handle session continuity with provided session ID', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Follow-up response' },
        citations: [],
        sessionId: 'existing-session-456',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Follow-up question', 'existing-session-456');

      expect(result.sessionId).toBe('existing-session-456');
      
      // Verify the command was called with the session ID
      const calls = bedrockMock.commandCalls(RetrieveAndGenerateCommand);
      expect(calls[0].args[0].input.sessionId).toBe('existing-session-456');
    });

    it('should generate session ID when none provided', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'New session response' },
        citations: [],
        // No sessionId in response to test generation
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('New question');

      expect(result.sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
    });

    it('should handle guardrail interventions', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: '' },
        citations: [],
        sessionId: 'blocked-session',
        guardrailAction: 'INTERVENED',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Inappropriate question');

      expect(result.guardrailAction).toBe('INTERVENED');
      expect(result.output.text).toBe('');
    });

    it('should allow overriding guardrails for specific requests', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Compliance response with alternate guardrail' },
        citations: [],
        guardrailAction: 'NONE',
        sessionId: 'override-guardrail-session',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Compliance query', undefined, {
        guardrailOverride: {
          guardrailId: 'override-guardrail',
          guardrailVersion: '2',
        },
      });

      expect(result.guardrailAction).toBe('NONE');

      const calls = bedrockMock.commandCalls(RetrieveAndGenerateCommand);
      expect(
        calls[0].args[0].input.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration
          .generationConfiguration.guardrailConfiguration
      ).toEqual({ guardrailId: 'override-guardrail', guardrailVersion: '2' });
    });

    it('should handle empty citations gracefully', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Response without citations' },
        citations: [],
        sessionId: 'no-citations-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Question with no relevant sources');

      expect(result.citations).toHaveLength(0);
      expect(result.output.text).toBe('Response without citations');
    });
  });

  describe('retrieveContext method', () => {
    it('should return trimmed context snippets', async () => {
      const mockRetrieveResponse: RetrieveCommandOutput = {
        retrievalResults: [
          { content: { text: ' First snippet ' } },
          { content: { text: '' } },
          { content: { text: 'Second snippet' } },
          { content: {} as any },
        ],
        guardrailAction: 'NONE',
      } as RetrieveCommandOutput;

      bedrockMock.on(RetrieveCommand).resolves(mockRetrieveResponse);

      const snippets = await knowledgeBase.retrieveContext('customer policy');

      expect(snippets).toEqual(['First snippet', 'Second snippet']);

      const calls = bedrockMock.commandCalls(RetrieveCommand);
      expect(calls[0].args[0].input.knowledgeBaseId).toBe('test-kb-id');
      expect(calls[0].args[0].input.retrievalQuery?.text).toBe('customer policy');
    });

    it('should surface retrieval errors through standardized handler', async () => {
      const retrievalError = new Error('Service unavailable');
      retrievalError.name = 'ServiceUnavailableException';
      (retrievalError as any).$metadata = { httpStatusCode: 503 };

      bedrockMock.on(RetrieveCommand).rejects(retrievalError);

      await expect(knowledgeBase.retrieveContext('outage scenario')).rejects.toMatchObject({
        name: 'ServiceUnavailableException',
        retryable: true,
        statusCode: 503,
      });
    });
  });

  describe('error handling', () => {
    it('should handle throttling exceptions as retryable', async () => {
      const throttlingError = new Error('Request rate exceeded');
      throttlingError.name = 'ThrottlingException';
      (throttlingError as any).$metadata = { httpStatusCode: 429 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(throttlingError);

      await expect(knowledgeBase.askKb('Test query')).rejects.toMatchObject({
        name: 'ThrottlingException',
        retryable: true,
        statusCode: 429,
        message: 'Request rate exceeded. Please retry after a delay.',
      });
    });

    it('should handle validation exceptions', async () => {
      const validationError = new Error('Invalid model ARN');
      validationError.name = 'ValidationException';
      (validationError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(validationError);

      await expect(knowledgeBase.askKb('Test query')).rejects.toMatchObject({
        name: 'ValidationException',
        retryable: false,
        statusCode: 400,
        message: 'Invalid request parameters: Invalid model ARN',
      });
    });

    it('should handle resource not found exceptions', async () => {
      const notFoundError = new Error('Knowledge base not found');
      notFoundError.name = 'ResourceNotFoundException';
      (notFoundError as any).$metadata = { httpStatusCode: 404 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(notFoundError);

      await expect(knowledgeBase.askKb('Test query')).rejects.toMatchObject({
        name: 'ResourceNotFoundException',
        retryable: false,
        statusCode: 404,
        message: 'Knowledge base or model not found: Knowledge base not found',
      });
    });

    it('should handle access denied exceptions', async () => {
      const accessError = new Error('Insufficient permissions');
      accessError.name = 'AccessDeniedException';
      (accessError as any).$metadata = { httpStatusCode: 403 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(accessError);

      await expect(knowledgeBase.askKb('Test query')).rejects.toMatchObject({
        name: 'AccessDeniedException',
        retryable: false,
        statusCode: 403,
        message: 'Insufficient permissions to access Bedrock resources',
      });
    });

    it('should handle service unavailable exceptions as retryable', async () => {
      const serviceError = new Error('Service temporarily unavailable');
      serviceError.name = 'ServiceUnavailableException';
      (serviceError as any).$metadata = { httpStatusCode: 503 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(serviceError);

      await expect(knowledgeBase.askKb('Test query')).rejects.toMatchObject({
        name: 'ServiceUnavailableException',
        retryable: true,
        statusCode: 503,
        message: 'Bedrock service temporarily unavailable',
      });
    });

    it('should handle guardrail content policy errors', async () => {
      const guardrailError = new Error('Content blocked by guardrail policy');
      guardrailError.name = 'UnknownError';

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(guardrailError);

      await expect(knowledgeBase.askKb('Blocked content')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        retryable: false,
        statusCode: 400,
        message: 'Content blocked by guardrails',
      });
    });
  });

  describe('citation processing', () => {
    it('should process complex citations with multiple references', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Complex response with multiple citations [1][2].' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'first citation',
                span: { start: 0, end: 14 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'First source content' },
                location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
                metadata: { title: 'Document 1' },
              },
              {
                content: { text: 'Second source content' },
                location: { s3Location: { uri: 's3://bucket/doc2.pdf' } },
                metadata: { title: 'Document 2' },
              },
            ],
          },
        ],
        sessionId: 'citation-test',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Complex query');

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].retrievedReferences).toHaveLength(2);
      expect(result.citations[0].retrievedReferences[0].location?.s3Location?.uri).toBe('s3://bucket/doc1.pdf');
      expect(result.citations[0].retrievedReferences[1].location?.s3Location?.uri).toBe('s3://bucket/doc2.pdf');
    });

    it('should handle citations without S3 locations', async () => {
      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Response with non-S3 citation [1].' },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'citation text',
                span: { start: 0, end: 13 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Source without location' },
                // No location provided
                metadata: { source: 'internal' },
              },
            ],
          },
        ],
        sessionId: 'no-location-test',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Query without S3 sources');

      expect(result.citations[0].retrievedReferences[0].location).toBeUndefined();
      expect(result.citations[0].retrievedReferences[0].content.text).toBe('Source without location');
    });
  });
});

describe('Factory function and utilities', () => {
  describe('createBedrockKnowledgeBase', () => {
    it('should create configured instance with factory function', () => {
      const kb = createBedrockKnowledgeBase(
        'test-kb',
        'test-model-arn',
        'test-guardrail',
        '1'
      );

      expect(kb).toBeInstanceOf(BedrockKnowledgeBase);
    });

    it('should include Bedrock placeholders in the default prompt template', async () => {
      bedrockMock.reset();

      const kb = createBedrockKnowledgeBase(
        'placeholder-kb',
        'placeholder-model-arn',
        'placeholder-guardrail',
        '1'
      );

      const mockResponse: RetrieveAndGenerateCommandOutput = {
        output: { text: 'Placeholder response [1].' },
        citations: [],
        sessionId: 'placeholder-session-id',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      await kb.askKb('How are placeholders handled?');

      const calls = bedrockMock.commandCalls(RetrieveAndGenerateCommand);
      const template =
        calls[0].args[0].input.retrieveAndGenerateConfiguration
          ?.knowledgeBaseConfiguration?.generationConfiguration?.promptTemplate
          ?.textPromptTemplate;

      expect(template).toContain('$search_results$');
      expect(template).toContain('$user_input$');
    });

    it('should throw error for invalid configuration in factory', () => {
      expect(() => {
        createBedrockKnowledgeBase('', 'model-arn', 'guardrail', '1');
      }).toThrow('Knowledge base ID is required');
    });
  });

  describe('isGuardrailIntervention', () => {
    it('should identify guardrail interventions by name', () => {
      const error = {
        name: 'GuardrailIntervention',
        message: 'Content blocked',
        statusCode: 400,
      };

      expect(isGuardrailIntervention(error)).toBe(true);
    });

    it('should identify guardrail interventions by message content', () => {
      const error = {
        name: 'UnknownError',
        message: 'Content blocked by guardrail policy',
        statusCode: 400,
      };

      expect(isGuardrailIntervention(error)).toBe(true);
    });

    it('should not identify non-guardrail errors', () => {
      const error = {
        name: 'ValidationException',
        message: 'Invalid parameter',
        statusCode: 400,
      };

      expect(isGuardrailIntervention(error)).toBe(false);
    });
  });

  describe('extractSessionId', () => {
    it('should extract session ID from response', () => {
      const response = {
        output: { text: 'test' },
        citations: [],
        guardrailAction: 'NONE' as const,
        sessionId: 'test-session-id',
      };

      expect(extractSessionId(response)).toBe('test-session-id');
    });
  });

  describe('formatCitationsForDisplay', () => {
    it('should format citations for display', () => {
      const citations: Citation[] = [
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'citation 1',
              span: { start: 0, end: 10 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Source 1' },
              location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
            },
          ],
        },
        {
          generatedResponsePart: {
            textResponsePart: {
              text: 'citation 2',
              span: { start: 11, end: 21 },
            },
          },
          retrievedReferences: [
            {
              content: { text: 'Source 2' },
              location: { s3Location: { uri: 's3://bucket/doc2.pdf' } },
            },
            {
              content: { text: 'Source 3' },
            },
          ],
        },
      ];

      const formatted = formatCitationsForDisplay(citations);
      
      expect(formatted).toContain('[1] 1 reference(s): s3://bucket/doc1.pdf');
      expect(formatted).toContain('[2] 2 reference(s): s3://bucket/doc2.pdf, Unknown source');
    });

    it('should handle empty citations', () => {
      expect(formatCitationsForDisplay([])).toBe('');
      expect(formatCitationsForDisplay(undefined as any)).toBe('');
    });
  });
});

describe('Integration scenarios', () => {
  let knowledgeBase: BedrockKnowledgeBase;

  beforeEach(() => {
    bedrockMock.reset();
    knowledgeBase = createBedrockKnowledgeBase(
      'integration-kb',
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      'integration-guardrail',
      'DRAFT'
    );
  });

  it('should simulate "Insufficient basis" template scenario', async () => {
    const mockResponse: RetrieveAndGenerateCommandOutput = {
      output: {
        text: 'I don\'t have sufficient information in the provided context to answer this question. The following sections might contain relevant information: [policy guidelines, compliance procedures]',
      },
      citations: [], // Empty citations to force insufficient basis
      sessionId: 'insufficient-basis-session',
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

    const result = await knowledgeBase.askKb('Very specific question not in corpus');

    expect(result.output.text).toContain('don\'t have sufficient information');
    expect(result.citations).toHaveLength(0);
  });

  it('should handle denied topic guardrail intervention', async () => {
    const guardrailError = new Error('Topic blocked by guardrail');
    guardrailError.name = 'ValidationException';
    (guardrailError as any).message = 'Content blocked by guardrail policy - denied topic detected';

    bedrockMock.on(RetrieveAndGenerateCommand).rejects(guardrailError);

    await expect(knowledgeBase.askKb('Denied topic query')).rejects.toMatchObject({
      name: 'GuardrailIntervention',
      message: 'Content blocked by guardrails',
    });
  });

  it('should handle conversation flow with session management', async () => {
    const sessionId = 'conversation-session-123';
    
    // Test first query
    const firstResponse: RetrieveAndGenerateCommandOutput = {
      output: { text: 'Initial response about policies [1].' },
      citations: [
        {
          generatedResponsePart: {
            textResponsePart: { text: 'policies', span: { start: 23, end: 31 } },
          },
          retrievedReferences: [
            {
              content: { text: 'Policy document content' },
              location: { s3Location: { uri: 's3://bucket/policy.pdf' } },
            },
          ],
        },
      ],
      sessionId: sessionId,
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(firstResponse);
    const firstResult = await knowledgeBase.askKb('What are the main policies?');
    expect(firstResult.sessionId).toBe(sessionId);

    // Reset mock for second call
    bedrockMock.reset();
    
    // Test follow-up query with same session
    const followUpResponse: RetrieveAndGenerateCommandOutput = {
      output: { text: 'Follow-up response building on previous context [1].' },
      citations: [
        {
          generatedResponsePart: {
            textResponsePart: { text: 'context', span: { start: 45, end: 52 } },
          },
          retrievedReferences: [
            {
              content: { text: 'Related policy content' },
              location: { s3Location: { uri: 's3://bucket/related.pdf' } },
            },
          ],
        },
      ],
      sessionId: sessionId,
      guardrailAction: 'NONE',
    };

    bedrockMock.on(RetrieveAndGenerateCommand).resolves(followUpResponse);
    const followUpResult = await knowledgeBase.askKb('Can you elaborate on that?', sessionId);

    expect(followUpResult.sessionId).toBe(sessionId);
    expect(followUpResult.output.text).toContain('building on previous context');
  });
});