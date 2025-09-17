import type { GuardrailConfiguration, PiiEntity } from "../types.js";
import type { PiiDetectionResult, PiiService } from "../pii.js";

const COMPLIANCE_REGEX = /(?=.*\b(?:compliance|comply|policy|policies|procedure|procedures|guideline|guidelines|requirement|requirements|regulation|regulations|standard|standards|allowed|permitted|how should|process|processes|governance)\b)(?=.*\b(?:pii|personal information|personal data|personally identifiable|sensitive data|customer data|data handling|data retention|data protection|privacy|data request|data requests|social security|ssn|phi)\b)/i;

export function looksLikeCompliance(text: string): boolean {
  if (!text) {
    return false;
  }

  return COMPLIANCE_REGEX.test(text);
}

export interface GuardrailDefinitions {
  default: GuardrailConfiguration;
  compliance?: GuardrailConfiguration;
}

export interface GuardrailSelectionResult {
  guardrail: GuardrailConfiguration;
  usedCompliance: boolean;
  detection?: PiiDetectionResult;
}

export interface ChooseGuardrailIdParams {
  prompt: string;
  contextTexts?: string[];
  guardrails: GuardrailDefinitions;
  piiService: Pick<PiiService, "detect">;
  logger?: {
    info?: (
      message: string,
      metadata?: Record<string, any>,
      operation?: string,
      duration?: number
    ) => void;
    debug?: (
      message: string,
      metadata?: Record<string, any>,
      operation?: string,
      duration?: number
    ) => void;
    warn?: (
      message: string,
      metadata?: Record<string, any>,
      operation?: string,
      duration?: number
    ) => void;
  };
}

const LOW_RISK_PII_TYPES = new Set([
  "NAME",
  "PERSON",
  "TITLE",
  "JOB_TITLE",
  "ORGANIZATION",
  "COMPANY",
]);

function hasMediumOrHighPii(entities: PiiEntity[]): boolean {
  return entities.some((entity) => {
    const type = entity.Type?.toUpperCase?.() ?? "";
    return !LOW_RISK_PII_TYPES.has(type);
  });
}

function buildCombinedText(prompt: string, contextTexts: string[] = []): string {
  return [prompt, ...contextTexts]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

export async function chooseGuardrailId({
  prompt,
  contextTexts = [],
  guardrails,
  piiService,
  logger,
}: ChooseGuardrailIdParams): Promise<GuardrailSelectionResult> {
  const complianceGuardrail = guardrails.compliance;

  if (!complianceGuardrail) {
    logger?.debug?.("Compliance guardrail unavailable; falling back to default", {
      reason: "missing_compliance_guardrail",
    });
    return {
      guardrail: guardrails.default,
      usedCompliance: false,
    };
  }

  if (!looksLikeCompliance(prompt)) {
    logger?.debug?.("Prompt does not appear to request compliance guidance", {
      reason: "non_compliance_prompt",
    });
    return {
      guardrail: guardrails.default,
      usedCompliance: false,
    };
  }

  const combinedText = buildCombinedText(prompt, contextTexts);

  if (!combinedText) {
    logger?.info?.("Compliance guardrail selected with empty combined text", {
      reason: "empty_combined_text",
    });
    return {
      guardrail: complianceGuardrail,
      usedCompliance: true,
      detection: { noneFound: true, entities: [] },
    };
  }

  try {
    const detection = await piiService.detect(combinedText);
    const containsMediumOrHigh = hasMediumOrHighPii(detection.entities);

    if (!containsMediumOrHigh) {
      logger?.info?.("Compliance guardrail selected after PII scan", {
        reason: "no_medium_high_pii",
        detectedEntities: detection.entities.length,
      });
      return {
        guardrail: complianceGuardrail,
        usedCompliance: true,
        detection,
      };
    }

    logger?.debug?.("Default guardrail retained due to detected PII", {
      reason: "medium_high_pii_detected",
      entityTypes: detection.entities.map((entity) => entity.Type),
    });
    return {
      guardrail: guardrails.default,
      usedCompliance: false,
      detection,
    };
  } catch (error) {
    logger?.warn?.("PII detection failed during guardrail selection; using default guardrail", {
      reason: "pii_detection_failed",
      error: (error as Error).message,
    });
    return {
      guardrail: guardrails.default,
      usedCompliance: false,
    };
  }
}
