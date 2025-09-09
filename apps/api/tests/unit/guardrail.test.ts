/**
 * Comprehensive Unit Tests for Guardrail Intervention Scenarios
 * 
 * Tests cover various guardrail intervention types, denied topics, PII masking integration,
 * and custom blocked messaging as specified in requirements 1.5, 3.4, and 8.3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
} from '@aws-sdk/client-comprehend';

import { BedrockKnowledgeBase, isGuardrailIntervention } from '../../src/bedrock.js';
import { PiiService } from '../../src/pii.js';
import type { KnowledgeBaseConfig, AwsServiceError } from '../../src/types.js';

// Mock the AWS clients
const bedrockMock = mockClient(BedrockAgentRuntimeClient);
const comprehendMock = mockClient(ComprehendClient);

describe('Guardrail Intervention Scenarios', () => {
  let knowledgeBase: BedrockKnowledgeBase;
  let piiService: PiiService;
  let mockConfig: KnowledgeBaseConfig;

  beforeEach(() => {
    bedrockMock.reset();
    comprehendMock.reset();
    
    mockConfig = {
      knowledgeBaseId: 'guardrail-test-kb',
      modelArn: 'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      generationConfiguration: {
        guardrailConfiguration: {
          guardrailId: 'strict-guardrail-id',
          guardrailVersion: 'DRAFT',
        },
        inferenceConfig: {
          textInferenceConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxTokens: 800,
          },
        },
        promptTemplate: {
          textPromptTemplate: 'Strict prompt: {context}\nQuestion: {question}\nAnswer:',
        },
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: 6,
        },
      },
    };

    knowledgeBase = new BedrockKnowledgeBase(mockConfig);
    piiService = new PiiService();
  });

  describe('Harm Category Interventions', () => {
    it('should handle HATE category intervention', async () => {
      const hateError = new Error('Content contains hate speech');
      hateError.name = 'ValidationException';
      (hateError as any).message = 'Content blocked by guardrail policy - HATE category violation';
      (hateError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(hateError);

      await expect(knowledgeBase.askKb('Hateful content query')).rejects.toMatchObject({
        name: 'ValidationException',
        message: 'Invalid request parameters: Content blocked by guardrail policy - HATE category violation',
        statusCode: 400,
        retryable: false,
      });
    });

    it('should handle VIOLENCE category intervention', async () => {
      const violenceError = new Error('Content promotes violence');
      violenceError.name = 'ValidationException';
      (violenceError as any).message = 'Content blocked by guardrail - VIOLENCE category detected';
      (violenceError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(violenceError);

      await expect(knowledgeBase.askKb('Violent content query')).rejects.toMatchObject({
        name: 'ValidationException',
        message: 'Invalid request parameters: Content blocked by guardrail - VIOLENCE category detected',
        statusCode: 400,
      });
    });

    it('should handle SELF_HARM category intervention', async () => {
      const selfHarmError = new Error('Content promotes self-harm');
      selfHarmError.name = 'ValidationException';
      (selfHarmError as any).message = 'Guardrail intervention: SELF_HARM content detected';
      (selfHarmError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(selfHarmError);

      await expect(knowledgeBase.askKb('Self-harm related query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle SEXUAL category intervention', async () => {
      const sexualError = new Error('Content contains sexual material');
      sexualError.name = 'ValidationException';
      (sexualError as any).message = 'Content policy violation - SEXUAL category';
      (sexualError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(sexualError);

      await expect(knowledgeBase.askKb('Sexual content query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle multiple harm categories in single intervention', async () => {
      const multiHarmError = new Error('Multiple violations detected');
      multiHarmError.name = 'ValidationException';
      (multiHarmError as any).message = 'Guardrail blocked content: HATE, VIOLENCE categories violated';
      (multiHarmError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(multiHarmError);

      await expect(knowledgeBase.askKb('Multi-category harmful query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });
  });

  describe('Denied Topics Interventions', () => {
    it('should handle specific denied topic intervention', async () => {
      const deniedTopicError = new Error('Topic is explicitly denied');
      deniedTopicError.name = 'ValidationException';
      (deniedTopicError as any).message = 'Content blocked - denied topic detected: financial advice';
      (deniedTopicError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(deniedTopicError);

      await expect(knowledgeBase.askKb('Give me financial investment advice')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle legal advice denied topic', async () => {
      const legalAdviceError = new Error('Legal advice topic denied');
      legalAdviceError.name = 'ValidationException';
      (legalAdviceError as any).message = 'Guardrail intervention: denied topic - legal advice';
      (legalAdviceError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(legalAdviceError);

      await expect(knowledgeBase.askKb('What legal action should I take?')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle medical advice denied topic', async () => {
      const medicalAdviceError = new Error('Medical advice not allowed');
      medicalAdviceError.name = 'ValidationException';
      (medicalAdviceError as any).message = 'Content policy: medical advice topic is denied';
      (medicalAdviceError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(medicalAdviceError);

      await expect(knowledgeBase.askKb('What medication should I take for my symptoms?')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle custom organization-specific denied topics', async () => {
      const customDeniedError = new Error('Organization-specific topic denied');
      customDeniedError.name = 'ValidationException';
      (customDeniedError as any).message = 'Guardrail blocked: denied topic - internal security protocols';
      (customDeniedError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(customDeniedError);

      await expect(knowledgeBase.askKb('Tell me about internal security protocols')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });
  });

  describe('PII-Related Guardrail Interventions', () => {
    it('should handle PII masking guardrail intervention', async () => {
      const piiGuardrailError = new Error('PII detected and blocked');
      piiGuardrailError.name = 'ValidationException';
      (piiGuardrailError as any).message = 'Guardrail intervention: PII entities detected and masked';
      (piiGuardrailError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(piiGuardrailError);

      await expect(knowledgeBase.askKb('Query with john.doe@example.com')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle successful PII masking by guardrails in response', async () => {
      const mockResponse = {
        output: { 
          text: 'The policy applies to users like <REDACTED:EMAIL> and phone numbers like <REDACTED:PHONE>.' 
        },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'policy applies',
                span: { start: 4, end: 18 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Policy document with PII examples' },
                location: { s3Location: { uri: 's3://bucket/policy-pii.pdf' } },
              },
            ],
          },
        ],
        sessionId: 'pii-masked-session',
        guardrailAction: 'INTERVENED', // Guardrail intervened but allowed masked response
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('What is the policy for user contacts?');

      expect(result.output.text).toContain('<REDACTED:EMAIL>');
      expect(result.output.text).toContain('<REDACTED:PHONE>');
      expect(result.guardrailAction).toBe('INTERVENED');
      expect(result.citations).toHaveLength(1);
    });

    it('should handle excessive PII in query leading to complete block', async () => {
      const excessivePiiError = new Error('Too much PII detected');
      excessivePiiError.name = 'ValidationException';
      (excessivePiiError as any).message = 'Guardrail blocked: excessive PII entities detected in input';
      (excessivePiiError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(excessivePiiError);

      const queryWithManyPii = 'Contact John Doe at john.doe@example.com, phone 555-123-4567, SSN 123-45-6789, address 123 Main St';
      
      await expect(knowledgeBase.askKb(queryWithManyPii)).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });
  });

  describe('Custom Blocked Messages', () => {
    it('should handle custom blocked input message', async () => {
      const customBlockedError = new Error('Custom input blocked message');
      customBlockedError.name = 'ValidationException';
      (customBlockedError as any).message = 'I cannot process requests that contain inappropriate content. Please rephrase your question.';
      (customBlockedError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(customBlockedError);

      await expect(knowledgeBase.askKb('Inappropriate query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle custom blocked output message in response', async () => {
      const mockResponse = {
        output: { 
          text: 'I apologize, but I cannot provide information on that topic as it violates our content policies. Please ask about our approved policy areas instead.' 
        },
        citations: [],
        sessionId: 'custom-blocked-session',
        guardrailAction: 'INTERVENED',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Blocked topic query');

      expect(result.output.text).toContain('cannot provide information on that topic');
      expect(result.output.text).toContain('violates our content policies');
      expect(result.guardrailAction).toBe('INTERVENED');
      expect(result.citations).toHaveLength(0);
    });

    it('should handle organization-specific custom messages', async () => {
      const orgSpecificError = new Error('Organization-specific blocked message');
      orgSpecificError.name = 'ValidationException';
      (orgSpecificError as any).message = 'This query relates to confidential company information. Please contact your manager for assistance with internal policy questions.';
      (orgSpecificError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(orgSpecificError);

      await expect(knowledgeBase.askKb('Confidential company query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });
  });

  describe('Guardrail Threshold Testing', () => {
    it('should handle HIGH threshold harm detection', async () => {
      const highThresholdError = new Error('High threshold violation');
      highThresholdError.name = 'ValidationException';
      (highThresholdError as any).message = 'Guardrail HIGH threshold exceeded for HATE category';
      (highThresholdError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(highThresholdError);

      await expect(knowledgeBase.askKb('High threshold harmful content')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle borderline content that passes threshold', async () => {
      const mockResponse = {
        output: { 
          text: 'This content discusses sensitive topics but within acceptable guidelines [1].' 
        },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'sensitive topics',
                span: { start: 22, end: 38 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Guidelines for sensitive content discussion' },
                location: { s3Location: { uri: 's3://bucket/guidelines.pdf' } },
              },
            ],
          },
        ],
        sessionId: 'borderline-content-session',
        guardrailAction: 'NONE', // Passed threshold
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Borderline sensitive query');

      expect(result.output.text).toContain('sensitive topics but within acceptable guidelines');
      expect(result.guardrailAction).toBe('NONE');
      expect(result.citations).toHaveLength(1);
    });
  });

  describe('Complex Intervention Scenarios', () => {
    it('should handle multiple simultaneous guardrail violations', async () => {
      const multiViolationError = new Error('Multiple guardrail violations');
      multiViolationError.name = 'ValidationException';
      (multiViolationError as any).message = 'Multiple guardrail violations: HATE category, denied topic (legal advice), PII detected';
      (multiViolationError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(multiViolationError);

      await expect(knowledgeBase.askKb('Complex multi-violation query')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle guardrail intervention during citation processing', async () => {
      const citationInterventionError = new Error('Citation content blocked');
      citationInterventionError.name = 'ValidationException';
      (citationInterventionError as any).message = 'Guardrail intervention during citation processing - source content blocked';
      (citationInterventionError as any).$metadata = { httpStatusCode: 400 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(citationInterventionError);

      await expect(knowledgeBase.askKb('Query that would cite blocked content')).rejects.toMatchObject({
        name: 'GuardrailIntervention',
        message: 'Content blocked by guardrails',
      });
    });

    it('should handle partial response with guardrail intervention', async () => {
      const mockResponse = {
        output: { 
          text: 'I can provide some information about this topic, but certain aspects cannot be discussed due to content policies.' 
        },
        citations: [
          {
            generatedResponsePart: {
              textResponsePart: {
                text: 'some information',
                span: { start: 13, end: 29 },
              },
            },
            retrievedReferences: [
              {
                content: { text: 'Partial information from allowed sources' },
                location: { s3Location: { uri: 's3://bucket/partial-allowed.pdf' } },
              },
            ],
          },
        ],
        sessionId: 'partial-intervention-session',
        guardrailAction: 'INTERVENED', // Partial intervention
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb('Query with partial restrictions');

      expect(result.output.text).toContain('certain aspects cannot be discussed');
      expect(result.output.text).toContain('content policies');
      expect(result.guardrailAction).toBe('INTERVENED');
      expect(result.citations).toHaveLength(1);
    });
  });

  describe('Guardrail Performance and Edge Cases', () => {
    it('should handle guardrail timeout scenarios', async () => {
      const timeoutError = new Error('Guardrail processing timeout');
      timeoutError.name = 'TimeoutException';
      (timeoutError as any).message = 'Guardrail processing exceeded timeout limit';
      (timeoutError as any).$metadata = { httpStatusCode: 408 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(timeoutError);

      await expect(knowledgeBase.askKb('Complex query causing guardrail timeout')).rejects.toMatchObject({
        name: 'TimeoutException',
        message: 'Guardrail processing exceeded timeout limit',
        statusCode: 500,
      });
    });

    it('should handle guardrail service unavailable', async () => {
      const unavailableError = new Error('Guardrail service unavailable');
      unavailableError.name = 'ServiceUnavailableException';
      (unavailableError as any).message = 'Guardrail service temporarily unavailable';
      (unavailableError as any).$metadata = { httpStatusCode: 503 };

      bedrockMock.on(RetrieveAndGenerateCommand).rejects(unavailableError);

      await expect(knowledgeBase.askKb('Query when guardrail unavailable')).rejects.toMatchObject({
        name: 'ServiceUnavailableException',
        retryable: true,
        statusCode: 503,
        message: 'Bedrock service temporarily unavailable',
      });
    });

    it('should handle very long queries with guardrail processing', async () => {
      const longQuery = 'This is a very long query that tests guardrail processing capabilities. ' + 'A'.repeat(5000);
      
      const mockResponse = {
        output: { 
          text: 'Processed long query successfully with guardrail validation.' 
        },
        citations: [],
        sessionId: 'long-query-session',
        guardrailAction: 'NONE',
      };

      bedrockMock.on(RetrieveAndGenerateCommand).resolves(mockResponse);

      const result = await knowledgeBase.askKb(longQuery);

      expect(result.output.text).toContain('Processed long query successfully');
      expect(result.guardrailAction).toBe('NONE');
    });
  });
});

describe('Guardrail Integration with PII Service', () => {
  let piiService: PiiService;

  beforeEach(() => {
    comprehendMock.reset();
    piiService = new PiiService();
  });

  describe('Pre-processing PII Detection with Guardrail Coordination', () => {
    it('should handle PII detection before guardrail processing', async () => {
      // Mock PII detection finding entities
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: 'EMAIL',
            Score: 0.99,
            BeginOffset: 8,
            EndOffset: 24,
          },
        ],
      });

      const result = await piiService.redactPII('Contact test@example.com for details');

      expect(result.maskedText).toBe('Contact <REDACTED:EMAIL> for details');
      expect(result.entitiesFound).toHaveLength(1);
    });

    it('should handle PII masking that prevents guardrail violations', async () => {
      // Simulate scenario where PII masking prevents a guardrail violation
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: 'PERSON',
            Score: 0.95,
            BeginOffset: 19,
            EndOffset: 27,
          },
          {
            Type: 'EMAIL',
            Score: 0.99,
            BeginOffset: 31,
            EndOffset: 47,
          },
        ],
      });

      const sensitiveQuery = 'Please investigate John Doe at john@company.com for policy violations';
      const result = await piiService.redactPII(sensitiveQuery);

      expect(result.maskedText).toBe('Please investigate <REDACTED:PERSON> at <REDACTED:EMAIL> for policy violations');
      expect(result.entitiesFound).toHaveLength(2);
    });

    it('should handle overlapping PII and potential guardrail content', async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: 'PERSON',
            Score: 0.9,
            BeginOffset: 0,
            EndOffset: 8,
          },
          {
            Type: 'PHONE',
            Score: 0.95,
            BeginOffset: 25,
            EndOffset: 37,
          },
        ],
      });

      const complexQuery = 'John Doe wants to harm 555-123-4567 owner';
      const result = await piiService.redactPII(complexQuery);

      expect(result.maskedText).toBe('<REDACTED:PERSON> wants to harm <REDACTED:PHONE> owner');
      // The word "harm" remains, which might trigger guardrails separately
    });
  });

  describe('Post-processing PII Detection after Guardrail Processing', () => {
    it('should handle PII in guardrail-approved responses', async () => {
      // Simulate response that passed guardrails but contains PII
      const responseWithPii = 'The policy allows contact via support@company.com or call 555-0123 for assistance.';
      
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: 'EMAIL',
            Score: 0.99,
            BeginOffset: 35,
            EndOffset: 53,
          },
          {
            Type: 'PHONE',
            Score: 0.95,
            BeginOffset: 62,
            EndOffset: 70,
          },
        ],
      });

      const result = await piiService.redactPII(responseWithPii);

      expect(result.maskedText).toBe('The policy allows contact via <REDACTED:EMAIL> or call <REDACTED:PHONE> for assistance.');
      expect(result.entitiesFound).toHaveLength(2);
    });

    it('should handle edge case where guardrail masking conflicts with PII masking', async () => {
      // Response already has some guardrail masking
      const partiallyMaskedResponse = 'Contact <BLOCKED_CONTENT> at admin@company.com for <BLOCKED_CONTENT>';
      
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: 'EMAIL',
            Score: 0.99,
            BeginOffset: 26,
            EndOffset: 42,
          },
        ],
      });

      const result = await piiService.redactPII(partiallyMaskedResponse);

      expect(result.maskedText).toBe('Contact <BLOCKED_CONTENT> at <REDACTED:EMAIL> for <BLOCKED_CONTENT>');
      expect(result.entitiesFound).toHaveLength(1);
    });
  });
});

describe('isGuardrailIntervention Utility Function', () => {
  describe('Comprehensive Pattern Matching', () => {
    it('should identify all guardrail intervention patterns', () => {
      const testCases = [
        // Direct name matches
        { error: { name: 'GuardrailIntervention', message: 'test', statusCode: 400 }, expected: true },
        
        // Message pattern matches (case insensitive)
        { error: { name: 'ValidationException', message: 'guardrail blocked content', statusCode: 400 }, expected: true },
        { error: { name: 'UnknownError', message: 'GUARDRAIL violation detected', statusCode: 400 }, expected: true },
        { error: { name: 'ServiceError', message: 'Content blocked by Guardrail', statusCode: 400 }, expected: true },
        { error: { name: 'ValidationException', message: 'content policy violation', statusCode: 400 }, expected: true },
        { error: { name: 'UnknownError', message: 'CONTENT POLICY blocked', statusCode: 400 }, expected: true },
        { error: { name: 'ServiceError', message: 'Policy violation detected', statusCode: 400 }, expected: true },
        
        // Non-guardrail errors
        { error: { name: 'ThrottlingException', message: 'Rate limit exceeded', statusCode: 429 }, expected: false },
        { error: { name: 'ValidationException', message: 'Invalid parameter value', statusCode: 400 }, expected: false },
        { error: { name: 'ResourceNotFoundException', message: 'Knowledge base not found', statusCode: 404 }, expected: false },
        { error: { name: 'AccessDeniedException', message: 'Insufficient permissions', statusCode: 403 }, expected: false },
        
        // Edge cases
        { error: { name: '', message: 'guardrail intervention', statusCode: 400 }, expected: true },
        { error: { name: 'TestError', message: '', statusCode: 400 }, expected: false },
        { error: { name: 'GuardrailIntervention', message: '', statusCode: 400 }, expected: true },
      ];

      testCases.forEach(({ error, expected }, index) => {
        expect(isGuardrailIntervention(error as AwsServiceError)).toBe(expected, 
          `Test case ${index + 1} failed: ${JSON.stringify(error)}`);
      });
    });

    it('should handle null and undefined values gracefully', () => {
      const edgeCases = [
        { name: null, message: 'guardrail blocked', statusCode: 400 },
        { name: 'ValidationException', message: null, statusCode: 400 },
        { name: undefined, message: 'content policy', statusCode: 400 },
        { name: 'GuardrailIntervention', message: undefined, statusCode: 400 },
      ];

      edgeCases.forEach(error => {
        expect(() => isGuardrailIntervention(error as any)).not.toThrow();
      });
    });

    it('should be case insensitive for message matching', () => {
      const caseVariations = [
        'GUARDRAIL BLOCKED CONTENT',
        'guardrail blocked content',
        'Guardrail Blocked Content',
        'GuArDrAiL bLoCkEd CoNtEnT',
        'CONTENT POLICY VIOLATION',
        'content policy violation',
        'Content Policy Violation',
      ];

      caseVariations.forEach(message => {
        const error = { name: 'ValidationException', message, statusCode: 400 };
        expect(isGuardrailIntervention(error)).toBe(true, `Failed for message: ${message}`);
      });
    });
  });
});