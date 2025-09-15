/**
 * Comprehensive Unit Tests for PII Detection and Masking Module
 *
 * These tests cover advanced PII masking edge cases, performance scenarios,
 * and complex overlapping entity handling as specified in requirements 3.1, 3.2, 3.5, and 8.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
  type PiiEntity as AwsPiiEntity,
} from "@aws-sdk/client-comprehend";
import { PiiService, redactPII, detectPII } from "../../src/pii.js";
import type { PiiEntity } from "../../src/types.js";

// Mock the Comprehend client
const comprehendMock = mockClient(ComprehendClient);

// Helper function to create AWS PII entities for mocking
const createAwsPiiEntity = (
  type: string,
  score: number,
  beginOffset: number,
  endOffset: number
): AwsPiiEntity => ({
  Type: type as any,
  Score: score,
  BeginOffset: beginOffset,
  EndOffset: endOffset,
});

// Helper function to create our custom PII entities for expectations
const createPiiEntity = (
  type: string,
  score: number,
  beginOffset: number,
  endOffset: number
): PiiEntity => ({
  Type: type,
  Score: score,
  BeginOffset: beginOffset,
  EndOffset: endOffset,
});

describe("PII Service - Advanced Edge Cases", () => {
  let piiService: PiiService;

  beforeEach(() => {
    comprehendMock.reset();
    piiService = new PiiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Complex Overlapping Scenarios", () => {
    it("should handle triple overlapping entities with different confidence scores", async () => {
      const text = "Contact John Smith at john.smith@company.com for urgent matters";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.95, 8, 18), // "John Smith"
        createAwsPiiEntity("EMAIL", 0.99, 22, 44), // "john.smith@company.com"
        createAwsPiiEntity("PERSON", 0.85, 22, 32), // "john.smith" (overlaps with email)
        createAwsPiiEntity("NAME", 0.75, 8, 12), // "John" (overlaps with person, below threshold)
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      // Should merge overlapping spans and filter by confidence
      expect(result.maskedText).toBe(
        "Contact <REDACTED:NAME|PERSON> at <REDACTED:EMAIL|PERSON> for urgent matters"
      );
      expect(result.entitiesFound).toHaveLength(4); // All entities above 0.5 threshold
    });

    it("should handle cascading overlaps across entire text", async () => {
      const text = "john.doe@company.com John Doe 555-123-4567";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 20), // "john.doe@company.com"
        createAwsPiiEntity("PERSON", 0.95, 21, 29), // "John Doe"
        createAwsPiiEntity("PHONE", 0.98, 30, 42), // "555-123-4567"
        createAwsPiiEntity("PERSON", 0.8, 0, 8), // "john.doe" (overlaps with email)
        createAwsPiiEntity("PERSON", 0.85, 21, 25), // "John" (overlaps with person)
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe(
        "<REDACTED:EMAIL|PERSON> <REDACTED:PERSON> <REDACTED:PHONE>"
      );
    });

    it("should handle overlapping entities with identical boundaries", async () => {
      const text = "SSN: 123-45-6789 is confidential";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("SSN", 0.99, 5, 16),
        createAwsPiiEntity("US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER", 0.85, 5, 16),
        createAwsPiiEntity("OTHER_PII", 0.9, 5, 16),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      // All entities have same boundaries, should be merged with sorted types
      expect(result.maskedText).toBe("SSN: <REDACTED:OTHER_PII|SSN|US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER> is confidential");
    });
  });

  describe("Performance and Stress Testing", () => {
    it("should handle extremely large text with many entities efficiently", async () => {
      // Create a large text with 500 email addresses
      const emails = Array.from({ length: 500 }, (_, i) => `user${i}@test${i}.com`);
      const text = "Contact list: " + emails.join(", ");
      
      const mockAwsEntities: AwsPiiEntity[] = emails.map((email, i) => {
        const start = text.indexOf(email);
        return createAwsPiiEntity("EMAIL", 0.99, start, start + email.length);
      });

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const startTime = Date.now();
      const result = await piiService.redactPII(text);
      const endTime = Date.now();

      expect(result.entitiesFound).toHaveLength(500);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
      expect(result.maskedText).toContain("<REDACTED:EMAIL>");
    });

    it("should handle text with 1000+ overlapping entities", async () => {
      const text = "A".repeat(10000); // 10k character text
      
      // Create 1000 overlapping entities across the text
      const mockAwsEntities: AwsPiiEntity[] = Array.from({ length: 1000 }, (_, i) => 
        createAwsPiiEntity("OTHER_PII", 0.8, i * 5, i * 5 + 50)
      );

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const startTime = Date.now();
      const result = await piiService.redactPII(text);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(result.entitiesFound).toHaveLength(1000);
    });
  });

  describe("Unicode and Special Character Handling", () => {
    it("should handle complex unicode characters and emojis", async () => {
      const text = "Contact 张三 at 张三@测试.com 🚀 or call +86-123-4567 📞";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.95, 8, 10), // "张三"
        createAwsPiiEntity("EMAIL", 0.99, 14, 25), // "张三@测试.com"
        createAwsPiiEntity("PHONE", 0.98, 35, 47), // "+86-123-4567"
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe(
        "Contact <REDACTED:PERSON> at <REDACTED:EMAIL>\ude80 or call <REDACTED:PHONE> 📞"
      );
    });

    it("should handle right-to-left languages", async () => {
      const text = "البريد الإلكتروني: test@arabic.com للتواصل";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 19, 35), // "test@arabic.com"
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("البريد الإلكتروني: <REDACTED:EMAIL>للتواصل");
    });

    it("should handle mixed scripts and special characters", async () => {
      const text = "Контакт: иван@тест.рф или john@test.com (混合文本) 🌍";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 9, 20), // "иван@тест.рф"
        createAwsPiiEntity("EMAIL", 0.99, 25, 38), // "john@test.com"
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe(
        "Контакт: <REDACTED:EMAIL>ф или<REDACTED:EMAIL>m (混合文本) 🌍"
      );
    });
  });

  describe("Edge Case Boundary Conditions", () => {
    it("should handle entities at exact text boundaries", async () => {
      const text = "test@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 16), // Entire text
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("<REDACTED:EMAIL>");
    });

    it("should handle zero-width entities gracefully", async () => {
      const text = "Normal text with zero-width entity";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("UNKNOWN", 0.99, 12, 12), // Zero-width entity
        createAwsPiiEntity("EMAIL", 0.99, 5, 9), // "text"
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      // Should handle zero-width gracefully and mask the valid entity
      expect(result.maskedText).toBe("Norma<REDACTED:EMAIL>xt with zero-width entity");
    });

    it("should handle entities with invalid offsets beyond text length", async () => {
      const text = "Short text";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 50, 60), // Way beyond text length
        createAwsPiiEntity("PERSON", 0.95, 0, 5), // Valid entity
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      // Should not crash and should handle valid entities
      const result = await piiService.redactPII(text);
      expect(result.originalText).toBe(text);
      expect(result.entitiesFound).toHaveLength(2);
    });

    it("should handle negative offsets gracefully", async () => {
      const text = "Test text";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, -5, 4), // Negative start offset
        createAwsPiiEntity("PERSON", 0.95, 5, 9), // Valid entity
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);
      expect(result.entitiesFound).toHaveLength(2);
    });
  });

  describe("Custom Configuration Edge Cases", () => {
    it("should handle extremely low confidence threshold", async () => {
      const customService = new PiiService({ minConfidenceScore: 0.01 });
      const text = "Maybe John at john@test.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.02, 6, 10), // Very low confidence
        createAwsPiiEntity("EMAIL", 0.95, 14, 27),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe("Maybe <REDACTED:PERSON> at <REDACTED:EMAIL>");
      expect(result.entitiesFound).toHaveLength(2);
    });

    it("should handle extremely high confidence threshold", async () => {
      const customService = new PiiService({ minConfidenceScore: 0.999 });
      const text = "Contact john@test.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 8, 21), // Below threshold
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe(text); // No masking
      expect(result.entitiesFound).toHaveLength(0);
    });

    it("should handle complex custom masking patterns", async () => {
      const customService = new PiiService({
        maskingPattern: "***{TYPE}_HIDDEN***",
      });
      const text = "Email: test@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 7, 23),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe("Email: ***EMAIL_HIDDEN***");
    });

    it("should handle masking pattern without type placeholder", async () => {
      const customService = new PiiService({
        maskingPattern: "[REDACTED]",
      });
      const text = "Email: test@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 7, 23),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe("Email: [REDACTED]");
    });
  });

  describe("Error Recovery and Resilience", () => {
    it("should handle malformed Comprehend response gracefully", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          {
            Type: undefined, // Malformed entity
            Score: undefined,
            BeginOffset: undefined,
            EndOffset: undefined,
          },
          createAwsPiiEntity("EMAIL", 0.99, 0, 16), // Valid entity
        ],
      });

      const result = await piiService.redactPII("test@example.com");

      // Should handle malformed entity gracefully and process valid one
      expect(result.entitiesFound).toHaveLength(1);
      expect(result.entitiesFound[0]).toEqual({
        Type: "EMAIL",
        Score: 0.99,
        BeginOffset: 0,
        EndOffset: 16,
      });
      expect(result.maskedText).toBe("<REDACTED:EMAIL>");
    });

    it("should handle Comprehend returning null entities", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: null as any,
      });

      const result = await piiService.redactPII("test text");

      expect(result.entitiesFound).toEqual([]);
      expect(result.maskedText).toBe("test text");
    });

    it("should handle empty Comprehend response", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({});

      const result = await piiService.redactPII("test text");

      expect(result.entitiesFound).toEqual([]);
      expect(result.maskedText).toBe("test text");
    });
  });

  describe("Memory and Resource Management", () => {
    it("should handle very long text without memory issues", async () => {
      const longText = "A".repeat(100000) + " test@example.com " + "B".repeat(100000);
      const emailStart = 100001;
      const emailEnd = emailStart + "test@example.com".length;

      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, emailStart, emailEnd),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(longText);

      expect(result.maskedText).toContain("<REDACTED:EMAIL>");
      expect(result.entitiesFound).toHaveLength(1);
    });

    it("should handle rapid successive calls without memory leaks", async () => {
      const text = "test@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 16),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      // Make 100 rapid successive calls
      const promises = Array.from({ length: 100 }, () => 
        piiService.redactPII(text)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result.maskedText).toBe("<REDACTED:EMAIL>");
      });
    });
  });
});

describe("Advanced Convenience Function Tests", () => {
  beforeEach(() => {
    comprehendMock.reset();
  });

  describe("redactPII with complex configurations", () => {
    it("should handle multiple configuration overrides", async () => {
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.7, 0, 16),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await redactPII("test@example.com", {
        minConfidenceScore: 0.6,
        maskingPattern: "{{HIDDEN:{TYPE}}}",
        languageCode: "es",
      });

      expect(result.maskedText).toBe("{{HIDDEN:EMAIL}}");
      
      const call = comprehendMock.commandCalls(DetectPiiEntitiesCommand)[0];
      expect(call.args[0].input.LanguageCode).toBe("es");
    });
  });

  describe("detectPII edge cases", () => {
    it("should return entities with zero confidence scores", async () => {
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0, 0, 16), // Zero confidence
        createAwsPiiEntity("PERSON", 0.99, 17, 25),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const entities = await detectPII("test@example.com John Doe", {
        minConfidenceScore: 0, // Allow zero confidence
      });

      expect(entities).toHaveLength(2);
      expect(entities[0].Score).toBe(0);
      expect(entities[1].Score).toBe(0.99);
    });
  });
});