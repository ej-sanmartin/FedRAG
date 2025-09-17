import { describe, it, expect, vi } from 'vitest';

import {
  looksLikeCompliance,
  chooseGuardrailId,
  type GuardrailDefinitions,
} from './guardrailRouting.js';

const defaultGuardrails: GuardrailDefinitions = {
  default: {
    guardrailId: 'default-guardrail',
    guardrailVersion: '1',
  },
  compliance: {
    guardrailId: 'compliance-guardrail',
    guardrailVersion: '2',
  },
};

describe('guardrailRouting', () => {
  describe('looksLikeCompliance', () => {
    it('should detect compliance-oriented prompts with PII context keywords', () => {
      const prompt = 'What compliance policies govern customer PII deletion requests?';
      expect(looksLikeCompliance(prompt)).toBe(true);
    });

    it('should return false for non-compliance prompts', () => {
      const prompt = 'Tell me about the weather tomorrow.';
      expect(looksLikeCompliance(prompt)).toBe(false);
    });
  });

  describe('chooseGuardrailId', () => {
    it('should return default guardrail when compliance guardrail is not configured', async () => {
      const detect = vi.fn().mockResolvedValue({ noneFound: true, entities: [] });

      const selection = await chooseGuardrailId({
        prompt: 'How do we ensure compliance with personal data policies?',
        contextTexts: ['Follow the retention policy.'],
        guardrails: { default: defaultGuardrails.default },
        piiService: { detect } as any,
      });

      expect(selection.guardrail).toEqual(defaultGuardrails.default);
      expect(selection.usedCompliance).toBe(false);
      expect(detect).not.toHaveBeenCalled();
    });

    it('should select compliance guardrail when prompt is compliance oriented and no medium PII found', async () => {
      const detect = vi.fn().mockResolvedValue({ noneFound: true, entities: [] });

      const selection = await chooseGuardrailId({
        prompt: 'How should we comply with policy when handling personal information?',
        contextTexts: ['Always follow data protection processes.'],
        guardrails: defaultGuardrails,
        piiService: { detect } as any,
      });

      expect(selection.guardrail).toEqual(defaultGuardrails.compliance);
      expect(selection.usedCompliance).toBe(true);
      expect(detect).toHaveBeenCalledTimes(1);
    });

    it('should fall back to default guardrail when medium PII is detected', async () => {
      const detect = vi.fn().mockResolvedValue({
        noneFound: false,
        entities: [
          { Type: 'SSN', Score: 0.9, BeginOffset: 10, EndOffset: 14 },
        ],
      });

      const selection = await chooseGuardrailId({
        prompt: 'How should we comply with policy when handling personal information?',
        contextTexts: ['Employee SSN records must be encrypted.'],
        guardrails: defaultGuardrails,
        piiService: { detect } as any,
      });

      expect(selection.guardrail).toEqual(defaultGuardrails.default);
      expect(selection.usedCompliance).toBe(false);
      expect(detect).toHaveBeenCalledTimes(1);
    });

    it('should return default guardrail for non-compliance prompts without calling detect', async () => {
      const detect = vi.fn();

      const selection = await chooseGuardrailId({
        prompt: 'Summarize the company history.',
        contextTexts: ['Founded in 1990.'],
        guardrails: defaultGuardrails,
        piiService: { detect } as any,
      });

      expect(selection.guardrail).toEqual(defaultGuardrails.default);
      expect(selection.usedCompliance).toBe(false);
      expect(detect).not.toHaveBeenCalled();
    });
  });
});
