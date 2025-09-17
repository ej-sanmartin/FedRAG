import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

import { handler } from '../../src/index.js';

const knowledgeBaseMock = {
  askKnowledgeBase: vi.fn(),
  retrieveContext: vi.fn(),
};

vi.mock('../../src/services/knowledgeBase.js', () => ({
  KnowledgeBaseService: vi.fn().mockImplementation(() => knowledgeBaseMock),
}));

vi.mock('../../src/bedrock.js', () => ({
  createBedrockKnowledgeBase: vi.fn().mockReturnValue({}),
  isGuardrailIntervention: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/pii.js', () => ({
  PiiService: vi.fn(),
}));

vi.mock('../../src/telemetry/log.js', () => ({
  emitRequestTelemetry: vi.fn(),
}));

import { PiiService } from '../../src/pii.js';
import { emitRequestTelemetry } from '../../src/telemetry/log.js';

describe('Compliance routing integration', () => {
  let mockPiiService: { redactPII: ReturnType<typeof vi.fn>; detect: ReturnType<typeof vi.fn> };
  let context: Context;

  beforeEach(() => {
    vi.clearAllMocks();
    knowledgeBaseMock.askKnowledgeBase.mockReset();
    knowledgeBaseMock.retrieveContext.mockReset();

    mockPiiService = {
      redactPII: vi.fn(),
      detect: vi.fn(),
    };
    (PiiService as unknown as vi.Mock).mockImplementation(() => mockPiiService);

    Object.assign(process.env, {
      KB_ID: 'test-kb-id',
      MODEL_ARN:
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0',
      GR_DEFAULT_ID: 'test-guardrail-id',
      GR_DEFAULT_VERSION: '1',
      GR_COMPLIANCE_ID: 'test-compliance-guardrail',
      GR_COMPLIANCE_VERSION: '1',
      AWS_REGION: 'us-east-1',
      LOG_LEVEL: 'DEBUG',
    });

    knowledgeBaseMock.retrieveContext.mockResolvedValue({
      snippets: ['Refer to the official retention schedule.'],
      metadata: { retryCount: 0, cacheHit: false, degraded: false },
    });

    knowledgeBaseMock.askKnowledgeBase.mockResolvedValue({
      output: { text: 'Default knowledge base response.' },
      citations: [],
      guardrailAction: 'NONE',
      sessionId: 'session-123',
      metadata: { retryCount: 0, cacheHit: false, degraded: false },
    });

    context = {
      awsRequestId: 'test-request-id',
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn:
        'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: '128',
      logGroupName: '/aws/lambda/test-function',
      logStreamName: '2024/01/01/[$LATEST]test-stream',
      getRemainingTimeInMillis: () => 30000,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    } as unknown as Context;
  });

  afterEach(() => {
    delete process.env.KB_ID;
    delete process.env.MODEL_ARN;
    delete process.env.GR_DEFAULT_ID;
    delete process.env.GR_DEFAULT_VERSION;
    delete process.env.GR_COMPLIANCE_ID;
    delete process.env.GR_COMPLIANCE_VERSION;
    delete process.env.AWS_REGION;
    delete process.env.LOG_LEVEL;
  });

  function createEvent(query: string, sessionId = 'session-123'): APIGatewayProxyEventV2 {
    return {
      version: '2.0',
      routeKey: 'POST /chat',
      rawPath: '/chat',
      rawQueryString: '',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'user-agent': 'vitest',
      },
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api',
        domainName: 'example.com',
        domainPrefix: 'example',
        http: {
          method: 'POST',
          path: '/chat',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'vitest',
        },
        requestId: 'test-request',
        routeKey: 'POST /chat',
        stage: 'test',
        time: new Date().toISOString(),
        timeEpoch: Date.now(),
      },
      body: JSON.stringify({ query, sessionId }),
      isBase64Encoded: false,
      cookies: [],
      queryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      multiValueHeaders: undefined,
    } as unknown as APIGatewayProxyEventV2;
  }

  it('routes compliance prompts through the compliance guardrail with a single Bedrock invocation', async () => {
    const query =
      'Which compliance policies govern retention of customer PII records?';

    mockPiiService.redactPII
      .mockResolvedValueOnce({
        originalText: query,
        maskedText: query,
        entitiesFound: [],
      })
      .mockResolvedValueOnce({
        originalText: 'Compliance guidance response.',
        maskedText: 'Compliance guidance response.',
        entitiesFound: [],
      });

    mockPiiService.detect.mockResolvedValue({ noneFound: true, entities: [] });

    const event = createEvent(query);
    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.answer).toBe('Compliance guidance response.');

    expect(knowledgeBaseMock.askKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(knowledgeBaseMock.retrieveContext).toHaveBeenCalledTimes(1);

    const askArgs = knowledgeBaseMock.askKnowledgeBase.mock.calls[0][0];
    expect(askArgs.guardrail).toEqual({
      guardrailId: 'test-compliance-guardrail',
      guardrailVersion: '1',
    });
    expect(askArgs.intent).toBe('compliance');

    expect(mockPiiService.detect).toHaveBeenCalledTimes(1);
    expect(emitRequestTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailId: 'test-compliance-guardrail',
        isCompliance: true,
      })
    );
  });

  it('propagates knowledge base throttling as a degraded result', async () => {
    const query = 'Provide the retention schedule for archived customer data.';

    mockPiiService.redactPII
      .mockResolvedValueOnce({
        originalText: query,
        maskedText: query,
        entitiesFound: [],
      })
      .mockResolvedValueOnce({
        originalText:
          "I'm temporarily unable to retrieve verified knowledge base sources due to throttling.",
        maskedText:
          "I'm temporarily unable to retrieve verified knowledge base sources due to throttling.",
        entitiesFound: [],
      });

    mockPiiService.detect.mockResolvedValue({ noneFound: true, entities: [] });

    knowledgeBaseMock.askKnowledgeBase.mockResolvedValue({
      output: {
        text: "I'm temporarily unable to retrieve verified knowledge base sources due to throttling.",
      },
      citations: [],
      guardrailAction: 'NONE',
      sessionId: 'session-degraded',
      metadata: { retryCount: 2, cacheHit: false, degraded: true },
      error: { name: 'ThrottlingException', statusCode: 429 },
    });

    const event = createEvent(query);
    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.citations).toEqual([]);
    expect(body.guardrailAction).toBe('NONE');
    expect(body.answer).toContain('temporarily unable');

    expect(emitRequestTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ kbDegraded: true })
    );
  });

  it('keeps high risk PII prompts on the default guardrail and returns masked output', async () => {
    const query =
      'Which compliance controls cover employee SSN 123-45-6789 when offboarding?';

    mockPiiService.redactPII
      .mockResolvedValueOnce({
        originalText: query,
        maskedText:
          'Which compliance controls cover employee <REDACTED:PERSON> SSN <REDACTED:SSN> when offboarding?',
        entitiesFound: [
          { Type: 'PERSON', Score: 0.8 },
          { Type: 'SSN', Score: 0.95 },
        ],
      })
      .mockResolvedValueOnce({
        originalText: 'Ensure SSN 123-45-6789 is removed from all records.',
        maskedText: 'Ensure SSN <REDACTED:SSN> is removed from all records.',
        entitiesFound: [{ Type: 'SSN', Score: 0.9 }],
      });

    mockPiiService.detect.mockResolvedValue({
      noneFound: false,
      entities: [
        { Type: 'SSN', Score: 0.95, BeginOffset: 48, EndOffset: 59 },
      ],
    });

    knowledgeBaseMock.askKnowledgeBase.mockResolvedValue({
      output: { text: 'Ensure SSN 123-45-6789 is removed from all records.' },
      citations: [],
      guardrailAction: 'NONE',
      sessionId: 'session-ssn',
      metadata: { retryCount: 0, cacheHit: false, degraded: false },
    });

    const event = createEvent(query, 'session-ssn');
    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.answer).toBe(
      'Ensure SSN <REDACTED:SSN> is removed from all records.'
    );
    expect(body.redactedAnswer).toBe(
      'Ensure SSN <REDACTED:SSN> is removed from all records.'
    );
    expect(body.redactedQuery).toBe(
      'Which compliance controls cover employee <REDACTED:PERSON> SSN <REDACTED:SSN> when offboarding?'
    );

    const askArgs = knowledgeBaseMock.askKnowledgeBase.mock.calls[0][0];
    expect(askArgs.guardrail).toEqual({
      guardrailId: 'test-guardrail-id',
      guardrailVersion: '1',
    });
    expect(askArgs.intent).toBe('default');

    expect(mockPiiService.detect).toHaveBeenCalledTimes(1);
    expect(mockPiiService.detect.mock.calls[0][0]).toContain('123-45-6789');
    expect(emitRequestTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ isCompliance: false })
    );
  });
});
