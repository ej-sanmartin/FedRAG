/**
 * Unit Tests for PII Detection and Masking Module
 *
 * These tests cover PII masking edge cases, overlapping entities, error handling,
 * and performance scenarios as specified in requirements 3.1, 3.2, 3.5, and 8.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ComprehendClient,
  DetectPiiEntitiesCommand,
  type PiiEntity as AwsPiiEntity,
} from "@aws-sdk/client-comprehend";
import { PiiService, redactPII, detectPII } from "./pii.js";
import type { PiiEntity } from "./types.js";

// Mock the Comprehend client
const comprehendMock = mockClient(ComprehendClient);

// Helper function to create AWS PII entities for mocking
const createAwsPiiEntity = (
  type: string,
  score: number,
  beginOffset: number,
  endOffset: number
): AwsPiiEntity => ({
  Type: type as any, // Cast to satisfy AWS SDK type requirements
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

describe("PiiService", () => {
  let piiService: PiiService;

  beforeEach(() => {
    comprehendMock.reset();
    piiService = new PiiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("redactPII", () => {
    it("should handle empty text", async () => {
      const result = await piiService.redactPII("");

      expect(result).toEqual({
        originalText: "",
        maskedText: "",
        entitiesFound: [],
      });
    });

    it("should handle text with no PII entities", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [],
      });

      const result = await piiService.redactPII("This is normal text");

      expect(result.originalText).toBe("This is normal text");
      expect(result.maskedText).toBe("This is normal text");
      expect(result.entitiesFound).toEqual([]);
    });

    it("should handle whitespace-only text", async () => {
      const text = "   \n\t  ";
      const result = await piiService.redactPII(text);

      expect(result).toEqual({
        originalText: text,
        maskedText: text,
        entitiesFound: [],
      });
    });

    it("should throw error for invalid input", async () => {
      await expect(piiService.redactPII(null as any)).rejects.toThrow(
        "Invalid input: text must be a non-empty string"
      );

      await expect(piiService.redactPII(undefined as any)).rejects.toThrow(
        "Invalid input: text must be a non-empty string"
      );

      await expect(piiService.redactPII(123 as any)).rejects.toThrow(
        "Invalid input: text must be a non-empty string"
      );
    });

    it("should mask single PII entity", async () => {
      const text = "Contact John at john@example.com for details";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 16, 32),
      ];
      const expectedEntities: PiiEntity[] = [
        createPiiEntity("EMAIL", 0.99, 16, 32),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.originalText).toBe(text);
      expect(result.maskedText).toBe(
        "Contact John at <REDACTED:EMAIL> for details"
      );
      expect(result.entitiesFound).toEqual(expectedEntities);
    });

    it("should mask multiple non-overlapping PII entities", async () => {
      const text = "Call John at 555-123-4567 or email john@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PHONE", 0.95, 13, 25),
        createAwsPiiEntity("EMAIL", 0.99, 35, 51),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe(
        "Call John at <REDACTED:PHONE> or email <REDACTED:EMAIL>"
      );
      expect(result.entitiesFound).toHaveLength(2);
    });

    it("should handle overlapping PII entities correctly", async () => {
      const text = "John Smith john.smith@company.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.9, 0, 10), // "John Smith"
        createAwsPiiEntity("EMAIL", 0.99, 11, 33), // "john.smith@company.com"
        createAwsPiiEntity("PERSON", 0.85, 11, 21), // "john.smith" (overlaps with email)
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      // Should merge overlapping spans and mask appropriately
      expect(result.maskedText).toBe(
        "<REDACTED:PERSON> <REDACTED:EMAIL|PERSON>"
      );
      expect(result.entitiesFound).toHaveLength(3);
    });

    it("should handle completely overlapping entities", async () => {
      const text = "SSN: 123-45-6789";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("SSN", 0.99, 5, 16),
        createAwsPiiEntity("OTHER_PII", 0.8, 5, 16), // Exact same span
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("SSN: <REDACTED:OTHER_PII|SSN>");
    });

    it("should handle nested overlapping entities", async () => {
      const text = "Contact: John Doe (john.doe@email.com)";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.95, 9, 17), // "John Doe"
        createAwsPiiEntity("EMAIL", 0.99, 19, 37), // "john.doe@email.com"
        createAwsPiiEntity("PERSON", 0.8, 19, 27), // "john.doe" (nested in email)
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe(
        "Contact: <REDACTED:PERSON> (<REDACTED:EMAIL|PERSON>)"
      );
    });

    it("should filter entities by confidence score", async () => {
      const text = "Maybe John at john@test.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("PERSON", 0.3, 6, 10), // Below default threshold of 0.5
        createAwsPiiEntity("EMAIL", 0.95, 14, 27), // Above threshold
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("Maybe John at <REDACTED:EMAIL>");
      expect(result.entitiesFound).toHaveLength(1);
      expect(result.entitiesFound[0].Type).toBe("EMAIL");
    });

    it("should handle custom confidence threshold", async () => {
      const customService = new PiiService({ minConfidenceScore: 0.8 });
      const text = "Contact info: john@test.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.75, 14, 27), // Below custom threshold of 0.8
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe(text); // No masking due to low confidence
      expect(result.entitiesFound).toHaveLength(0);
    });

    it("should handle custom masking pattern", async () => {
      const customService = new PiiService({
        maskingPattern: "[HIDDEN-{TYPE}]",
      });
      const text = "Email: test@example.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 7, 23),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await customService.redactPII(text);

      expect(result.maskedText).toBe("Email: [HIDDEN-EMAIL]");
    });

    it("should handle text with special characters and unicode", async () => {
      const text = "Émile's email: émile@tëst.com 🚀";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.95, 15, 29),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("Émile's email: <REDACTED:EMAIL> 🚀");
    });

    it("should handle very long text with multiple entities", async () => {
      const longText = "A".repeat(1000) + " john@test.com " + "B".repeat(1000);
      const emailStart = 1001; // After 1000 A's and 1 space
      const emailEnd = emailStart + "john@test.com".length; // 13 characters

      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, emailStart, emailEnd),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(longText);

      const expectedText =
        "A".repeat(1000) + " <REDACTED:EMAIL> " + "B".repeat(1000);
      expect(result.maskedText).toBe(expectedText);
    });
  });

  describe("detect", () => {
    it("should indicate when no PII entities are present", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [],
      });

      const result = await piiService.detect("Standard operating procedures contain no personal data.");

      expect(result.noneFound).toBe(true);
      expect(result.entities).toEqual([]);
    });

    it("should return detected entities without masking", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [
          createAwsPiiEntity("EMAIL", 0.96, 10, 24),
          createAwsPiiEntity("PHONE", 0.91, 40, 52),
        ],
      });

      const result = await piiService.detect("Contact us at test@example.com or call 555-123-4567.");

      expect(result.noneFound).toBe(false);
      expect(result.entities).toEqual([
        createPiiEntity("EMAIL", 0.96, 10, 24),
        createPiiEntity("PHONE", 0.91, 40, 52),
      ]);
    });
  });

  describe("Error Handling", () => {
    it("should handle Comprehend service errors", async () => {
      const error = new Error("Service unavailable");
      error.name = "ServiceUnavailableException";

      comprehendMock.on(DetectPiiEntitiesCommand).rejects(error);

      await expect(piiService.redactPII("test text")).rejects.toThrow(
        "PII detection failed: Service unavailable"
      );
    });

    it("should handle throttling errors", async () => {
      const error = new Error("Rate exceeded");
      error.name = "ThrottlingException";
      (error as any).$retryable = { throttling: true };

      comprehendMock.on(DetectPiiEntitiesCommand).rejects(error);

      await expect(piiService.redactPII("test text")).rejects.toThrow(
        "PII detection failed: Rate exceeded"
      );
    });

    it("should handle malformed Comprehend response", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: undefined, // Malformed response
      });

      const result = await piiService.redactPII("test text");

      expect(result.entitiesFound).toEqual([]);
      expect(result.maskedText).toBe("test text");
    });

    it("should handle entities with invalid offsets", async () => {
      const text = "Short text";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 50, 60), // Invalid offset beyond text length
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      // Should not crash, but may produce unexpected results
      const result = await piiService.redactPII(text);
      expect(result.originalText).toBe(text);
    });
  });

  describe("Edge Cases", () => {
    it("should handle entities at text boundaries", async () => {
      const text = "john@test.com";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 13), // Entire text
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("<REDACTED:EMAIL>");
    });

    it("should handle adjacent entities", async () => {
      const text = "john@test.com555-1234";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 13),
        createAwsPiiEntity("PHONE", 0.95, 13, 21),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      expect(result.maskedText).toBe("<REDACTED:EMAIL><REDACTED:PHONE>");
    });

    it("should handle zero-length entities", async () => {
      const text = "Normal text";
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("UNKNOWN", 0.99, 5, 5), // Zero-length entity
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await piiService.redactPII(text);

      // Zero-length entities should be handled gracefully
      expect(result.originalText).toBe(text);
    });
  });

  describe("Performance and Configuration", () => {
    it("should use custom language code", async () => {
      const customService = new PiiService({ languageCode: "es" });

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [],
      });

      await customService.redactPII("texto de prueba");

      expect(
        comprehendMock.commandCalls(DetectPiiEntitiesCommand)
      ).toHaveLength(1);
      const call = comprehendMock.commandCalls(DetectPiiEntitiesCommand)[0];
      expect(call.args[0].input.LanguageCode).toBe("es");
    });

    it("should handle large number of entities efficiently", async () => {
      const text =
        "Multiple entities: " +
        Array.from({ length: 100 }, (_, i) => `user${i}@test.com`).join(" ");

      const mockAwsEntities: AwsPiiEntity[] = Array.from({ length: 100 }, (_, i) =>
        createAwsPiiEntity("EMAIL", 0.99, 19 + i * 15, 19 + i * 15 + 13)
      );

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const startTime = Date.now();
      const result = await piiService.redactPII(text);
      const endTime = Date.now();

      expect(result.entitiesFound).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});

describe("Convenience Functions", () => {
  beforeEach(() => {
    comprehendMock.reset();
  });

  describe("redactPII", () => {
    it("should work as standalone function", async () => {
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 13),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const result = await redactPII("test@test.com");

      expect(result.maskedText).toBe("<REDACTED:EMAIL>");
    });

    it("should accept custom configuration", async () => {
      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: [],
      });

      await redactPII("test text", { languageCode: "fr" });

      const call = comprehendMock.commandCalls(DetectPiiEntitiesCommand)[0];
      expect(call.args[0].input.LanguageCode).toBe("fr");
    });
  });

  describe("detectPII", () => {
    it("should return only entities without masking", async () => {
      const mockAwsEntities: AwsPiiEntity[] = [
        createAwsPiiEntity("EMAIL", 0.99, 0, 13),
      ];
      const expectedEntities: PiiEntity[] = [
        createPiiEntity("EMAIL", 0.99, 0, 13),
      ];

      comprehendMock.on(DetectPiiEntitiesCommand).resolves({
        Entities: mockAwsEntities,
      });

      const entities = await detectPII("test@test.com");

      expect(entities).toEqual(expectedEntities);
    });
  });
});
