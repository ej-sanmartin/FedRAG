/**
 * PII Detection and Masking Module
 * 
 * This module provides comprehensive PII detection and masking functionality using
 * Amazon Comprehend DetectPiiEntities API. It handles overlapping entity spans,
 * proper offset calculations, and configurable masking patterns.
 */

import { 
  ComprehendClient, 
  DetectPiiEntitiesCommand,
  type LanguageCode,
  type PiiEntity as AwsPiiEntity
} from '@aws-sdk/client-comprehend';
import type {
  PiiEntity,
  PiiMaskingResult,
  AwsServiceError
} from './types.js';

export interface PiiDetectionResult {
  noneFound: boolean;
  entities: PiiEntity[];
}

/**
 * Configuration for PII masking behavior
 */
export interface PiiMaskingConfig {
  /** Language code for text analysis (default: 'en') */
  languageCode: LanguageCode;
  /** Custom masking pattern (default: '<REDACTED:{TYPE}>') */
  maskingPattern: string;
  /** Minimum confidence score to mask entities (default: 0.5) */
  minConfidenceScore: number;
  /** Maximum retries for Comprehend API calls (default: 3) */
  maxRetries: number;
}

/**
 * Default configuration for PII masking
 */
const DEFAULT_CONFIG: PiiMaskingConfig = {
  languageCode: 'en' as LanguageCode,
  maskingPattern: '<REDACTED:{TYPE}>',
  minConfidenceScore: 0.5,
  maxRetries: 3,
};

/**
 * PII Detection and Masking Service
 */
export class PiiService {
  private comprehendClient: ComprehendClient;
  private config: PiiMaskingConfig;

  constructor(config: Partial<PiiMaskingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.comprehendClient = new ComprehendClient({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: this.config.maxRetries,
    });
  }

  /**
   * Detects and masks PII entities in the provided text
   * 
   * @param text - The text to analyze and mask
   * @returns Promise<PiiMaskingResult> - The masking result with original text, masked text, and entities found
   * @throws Error when Comprehend service fails or text is invalid
   */
  async redactPII(text: string): Promise<PiiMaskingResult> {
    const validatedText = this.validateInput(text);

    if (this.isTextEmpty(validatedText)) {
      return {
        originalText: validatedText,
        maskedText: validatedText,
        entitiesFound: [],
      };
    }

    try {
      const filteredEntities = await this.detectAndFilterEntities(validatedText);
      const maskedText = this.maskEntitiesInText(validatedText, filteredEntities);

      return {
        originalText: validatedText,
        maskedText,
        entitiesFound: filteredEntities,
      };
    } catch (error) {
      const awsError = this.handleComprehendError(error);
      throw new Error(`PII detection failed: ${awsError.message}`);
    }
  }

  async detect(text: string): Promise<PiiDetectionResult> {
    const validatedText = this.validateInput(text);

    if (this.isTextEmpty(validatedText)) {
      return { noneFound: true, entities: [] };
    }

    try {
      const filteredEntities = await this.detectAndFilterEntities(validatedText);
      return {
        noneFound: filteredEntities.length === 0,
        entities: filteredEntities,
      };
    } catch (error) {
      const awsError = this.handleComprehendError(error);
      throw new Error(`PII detection failed: ${awsError.message}`);
    }
  }

  /**
   * Detects PII entities using Amazon Comprehend
   * 
   * @private
   * @param text - The text to analyze
   * @returns Promise<PiiEntity[]> - Array of detected PII entities
   */
  private async detectPiiEntities(text: string): Promise<PiiEntity[]> {
    const command = new DetectPiiEntitiesCommand({
      Text: text,
      LanguageCode: this.config.languageCode,
    });

    const response = await this.comprehendClient.send(command);
    const awsEntities = response.Entities || [];

    // Convert AWS PiiEntity to our PiiEntity type
    return awsEntities.map((entity: AwsPiiEntity): PiiEntity => ({
      Type: entity.Type || 'UNKNOWN',
      Score: entity.Score || 0,
      BeginOffset: entity.BeginOffset || 0,
      EndOffset: entity.EndOffset || 0,
    }));
  }

  private async detectAndFilterEntities(text: string): Promise<PiiEntity[]> {
    const entities = await this.detectPiiEntities(text);
    return this.filterEntitiesByConfidence(entities);
  }

  /**
   * Filters entities by minimum confidence score
   * 
   * @private
   * @param entities - Array of detected entities
   * @returns PiiEntity[] - Filtered entities above confidence threshold
   */
  private filterEntitiesByConfidence(entities: PiiEntity[]): PiiEntity[] {
    return entities.filter(entity => entity.Score >= this.config.minConfidenceScore);
  }

  /**
   * Masks PII entities in text with proper handling of overlapping spans
   * 
   * This function handles overlapping entities by:
   * 1. Sorting entities by start position (descending) to process from end to beginning
   * 2. Merging overlapping spans to avoid double-masking
   * 3. Applying masks from right to left to preserve offset accuracy
   * 
   * @private
   * @param text - Original text
   * @param entities - PII entities to mask
   * @returns string - Text with PII entities masked
   */
  private maskEntitiesInText(text: string, entities: PiiEntity[]): string {
    if (entities.length === 0) {
      return text;
    }

    // Filter out entities with invalid offsets for masking only
    const validEntities = entities.filter(entity => 
      entity.BeginOffset >= 0 && 
      entity.EndOffset > entity.BeginOffset && 
      entity.EndOffset <= text.length
    );

    if (validEntities.length === 0) {
      return text;
    }

    // Sort entities by start position (descending) to process from end to beginning
    const sortedEntities = [...validEntities].sort((a, b) => b.BeginOffset - a.BeginOffset);
    
    // Merge overlapping spans to avoid double-masking
    const mergedSpans = this.mergeOverlappingSpans(sortedEntities);
    
    // Apply masking from right to left to preserve offsets
    let maskedText = text;
    for (const span of mergedSpans) {
      const maskText = this.generateMaskText(span.types);
      maskedText = maskedText.substring(0, span.start) + 
                   maskText + 
                   maskedText.substring(span.end);
    }

    return maskedText;
  }

  /**
   * Merges overlapping PII entity spans
   * 
   * @private
   * @param entities - Sorted entities (by start position, descending)
   * @returns Array of merged spans with entity types
   */
  private mergeOverlappingSpans(entities: PiiEntity[]): Array<{
    start: number;
    end: number;
    types: string[];
  }> {
    if (entities.length === 0) {
      return [];
    }

    const mergedSpans: Array<{ start: number; end: number; types: string[] }> = [];
    
    // Process entities from right to left (already sorted descending)
    for (const entity of entities) {
      const currentSpan = {
        start: entity.BeginOffset,
        end: entity.EndOffset,
        types: [entity.Type],
      };

      // Check if this span overlaps with any existing merged span
      let merged = false;
      for (const existingSpan of mergedSpans) {
        if (this.spansOverlap(currentSpan, existingSpan)) {
          // Merge the spans
          existingSpan.start = Math.min(existingSpan.start, currentSpan.start);
          existingSpan.end = Math.max(existingSpan.end, currentSpan.end);
          existingSpan.types.push(...currentSpan.types);
          merged = true;
          break;
        }
      }

      if (!merged) {
        mergedSpans.push(currentSpan);
      }
    }

    // Sort merged spans by start position (descending) for consistent processing
    return mergedSpans.sort((a, b) => b.start - a.start);
  }

  /**
   * Checks if two spans overlap
   * 
   * @private
   * @param span1 - First span
   * @param span2 - Second span
   * @returns boolean - True if spans overlap
   */
  private spansOverlap(
    span1: { start: number; end: number },
    span2: { start: number; end: number }
  ): boolean {
    return span1.start < span2.end && span2.start < span1.end;
  }

  /**
   * Generates mask text for given entity types
   * 
   * @private
   * @param types - Array of PII entity types
   * @returns string - Generated mask text
   */
  private generateMaskText(types: string[]): string {
    // Remove duplicates and sort for consistent output
    const uniqueTypes = [...new Set(types)].sort();
    
    if (uniqueTypes.length === 1) {
      return this.config.maskingPattern.replace('{TYPE}', uniqueTypes[0]);
    } else {
      // For multiple types, combine them
      const combinedTypes = uniqueTypes.join('|');
      return this.config.maskingPattern.replace('{TYPE}', combinedTypes);
    }
  }

  /**
   * Handles and normalizes Comprehend service errors
   * 
   * @private
   * @param error - Raw error from AWS SDK
   * @returns AwsServiceError - Normalized error object
   */
  private handleComprehendError(error: unknown): AwsServiceError {
    const err = error as any; // Type assertion for AWS SDK error
    const awsError: AwsServiceError = {
      name: err.name || 'ComprehendError',
      message: err.message || 'Unknown Comprehend service error',
      code: err.Code || err.$metadata?.httpStatusCode?.toString(),
      statusCode: err.$metadata?.httpStatusCode,
      retryable: err.$retryable?.throttling || false,
    };

    // Log error details for debugging (in production, use structured logging)
    console.error('Comprehend service error:', {
      name: awsError.name,
      message: awsError.message,
      code: awsError.code,
      statusCode: awsError.statusCode,
      retryable: awsError.retryable,
    });

    return awsError;
  }

  private validateInput(text: string): string {
    if (text === null || text === undefined || typeof text !== 'string') {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    return text;
  }

  private isTextEmpty(text: string): boolean {
    return text.length === 0 || text.trim().length === 0;
  }
}

/**
 * Convenience function to create a PII service instance and redact text
 * 
 * @param text - Text to redact
 * @param config - Optional configuration overrides
 * @returns Promise<PiiMaskingResult> - Redaction result
 */
export async function redactPII(
  text: string, 
  config?: Partial<PiiMaskingConfig>
): Promise<PiiMaskingResult> {
  const piiService = new PiiService(config);
  return piiService.redactPII(text);
}

/**
 * Convenience function to detect PII entities without masking
 * 
 * @param text - Text to analyze
 * @param config - Optional configuration overrides
 * @returns Promise<PiiEntity[]> - Detected PII entities
 */
export async function detectPII(
  text: string,
  config?: Partial<PiiMaskingConfig>
): Promise<PiiEntity[]> {
  const piiService = new PiiService(config);
  const detection = await piiService.detect(text);
  return detection.entities;
}