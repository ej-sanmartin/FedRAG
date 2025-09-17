import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  looksLikeCompliance,
  chooseGuardrailId,
  type GuardrailDefinitions,
} from '../../../src/safety/guardrailRouting.js';

describe('looksLikeCompliance', () => {
  it('identifies prompts that reference policies and PII concerns', () => {
    const prompt =
      'Which compliance policies govern how we process customer PII requests?';

    expect(looksLikeCompliance(prompt)).toBe(true);
  });

  it('returns false for non-compliance related prompts', () => {
    const prompt = 'What will the weather be like tomorrow in Seattle?';

    expect(looksLikeCompliance(prompt)).toBe(false);
  });
});

describe('chooseGuardrailId', () => {
  const guardrails: GuardrailDefinitions = {
    default: { guardrailId: 'default-guardrail', guardrailVersion: '1' },
    compliance: {
      guardrailId: 'compliance-guardrail',
      guardrailVersion: '2',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the compliance guardrail when the prompt looks like a compliance request and no medium/high PII is found', async () => {
    const detect = vi
      .fn()
      .mockResolvedValue({ noneFound: true, entities: [] });

    const result = await chooseGuardrailId({
      prompt: 'How should we comply with policy when handling customer PII?',
      contextTexts: ['Refer to the official retention procedures.'],
      guardrails,
      piiService: { detect } as any,
    });

    expect(result.usedCompliance).toBe(true);
    expect(result.guardrail).toEqual(guardrails.compliance);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(detect.mock.calls[0][0]).toContain('customer PII');
    expect(detect.mock.calls[0][0]).toContain('retention procedures');
  });

  it('falls back to the default guardrail when PII scan finds medium or high risk entities', async () => {
    const detect = vi.fn().mockResolvedValue({
      noneFound: false,
      entities: [
        { Type: 'SSN', Score: 0.9, BeginOffset: 10, EndOffset: 21 },
        { Type: 'NAME', Score: 0.7, BeginOffset: 30, EndOffset: 40 },
      ],
    });

    const result = await chooseGuardrailId({
      prompt:
        'Which compliance standards apply when storing an employee SSN securely?',
      contextTexts: ['SSNs must be encrypted both at rest and in transit.'],
      guardrails,
      piiService: { detect } as any,
    });

    expect(result.usedCompliance).toBe(false);
    expect(result.guardrail).toEqual(guardrails.default);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('skips PII detection and returns the default guardrail for non-compliance prompts', async () => {
    const detect = vi.fn();

    const result = await chooseGuardrailId({
      prompt: 'Summarize the company mission statement.',
      contextTexts: ['Founded in 1999 with a focus on analytics.'],
      guardrails,
      piiService: { detect } as any,
    });

    expect(result.usedCompliance).toBe(false);
    expect(result.guardrail).toEqual(guardrails.default);
    expect(detect).not.toHaveBeenCalled();
  });
});
