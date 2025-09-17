import { randomUUID } from "crypto";

import type {
  AwsServiceError,
  BedrockRetrieveAndGenerateResponse,
  GuardrailConfiguration,
} from "../types.js";
import { BedrockKnowledgeBase } from "../bedrock.js";

interface KnowledgeBaseServiceOptions {
  cacheSize?: number;
  ttlMs?: number;
  enabled?: boolean;
  topK?: number;
}

interface CacheKeyParts {
  intent: string;
  prompt: string;
  guardrailId: string;
  guardrailVersion: string;
  topK: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LruCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();

  constructor(private readonly capacity: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }

    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.capacity <= 0) {
      return;
    }

    const expiresAt = Date.now() + ttlMs;

    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, { value, expiresAt });
    this.trim();
  }

  private trim(): void {
    if (this.capacity <= 0) {
      this.map.clear();
      return;
    }

    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.map.delete(oldestKey);
    }
  }
}

export interface KnowledgeBaseTelemetry {
  retryCount: number;
  cacheHit: boolean;
  degraded: boolean;
}

export interface KnowledgeBaseAnswer
  extends BedrockRetrieveAndGenerateResponse {
  metadata: KnowledgeBaseTelemetry;
  error?: AwsServiceError;
}

export interface KnowledgeBaseContextResult {
  snippets: string[];
  metadata: KnowledgeBaseTelemetry;
  error?: AwsServiceError;
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return defaultValue;
}

function cloneSnippets(snippets: string[]): string[] {
  return snippets.map((snippet) => snippet);
}

function truncatePrompt(prompt: string, limit = 160): string {
  if (prompt.length <= limit) {
    return prompt;
  }

  return `${prompt.slice(0, limit - 1)}…`;
}

function isThrottleError(error?: AwsServiceError): boolean {
  if (!error) {
    return false;
  }

  if (error.statusCode === 429) {
    return true;
  }

  const candidate = (error.code ?? error.name ?? "").toString().toLowerCase();

  return (
    candidate.includes("throttling") ||
    candidate.includes("too_many_requests") ||
    candidate.includes("toomanyrequests")
  );
}

export class KnowledgeBaseService {
  private readonly contextCache: LruCache<string[]>;
  private readonly answerCache: LruCache<BedrockRetrieveAndGenerateResponse>;
  private readonly cacheEnabled: boolean;
  private readonly ttlMs: number;
  private readonly defaultTopK: number;

  constructor(
    private readonly bedrock: BedrockKnowledgeBase,
    options: KnowledgeBaseServiceOptions = {}
  ) {
    const cacheSize = options.cacheSize ?? parsePositiveInt(process.env.KB_CACHE_SIZE, 32);
    const ttlMs = options.ttlMs ?? parsePositiveInt(process.env.KB_CACHE_TTL_MS, 60000);
    const enabled = options.enabled ?? parseBoolean(process.env.KB_CACHE_ENABLED, true);

    this.cacheEnabled = enabled && cacheSize > 0 && ttlMs > 0;
    this.ttlMs = ttlMs > 0 ? ttlMs : 0;
    this.contextCache = new LruCache<string[]>(cacheSize);
    this.answerCache = new LruCache<BedrockRetrieveAndGenerateResponse>(cacheSize);
    this.defaultTopK = options.topK ?? this.bedrock.getDefaultTopK();
  }

  async retrieveContext(
    prompt: string,
    options: { intent?: string; guardrail?: GuardrailConfiguration; topK?: number } = {}
  ): Promise<KnowledgeBaseContextResult> {
    const normalizedPrompt = prompt.trim();
    const metadata: KnowledgeBaseTelemetry = {
      retryCount: 0,
      cacheHit: false,
      degraded: false,
    };

    const cacheKey = this.buildCacheKey({
      intent: options.intent ?? "guardrail_context",
      prompt: normalizedPrompt,
      guardrailId: options.guardrail?.guardrailId ?? "default",
      guardrailVersion: options.guardrail?.guardrailVersion ?? "default",
      topK: options.topK ?? this.defaultTopK,
    });

    if (this.cacheEnabled) {
      const cached = this.contextCache.get(cacheKey);
      if (cached) {
        metadata.cacheHit = true;
        return {
          snippets: cloneSnippets(cached),
          metadata,
        };
      }
    }

    try {
      const rawSnippets = await this.bedrock.retrieveContext(normalizedPrompt);
      metadata.retryCount = (rawSnippets as any)?.retryCount ?? 0;

      const snippets = cloneSnippets(rawSnippets);

      if (this.cacheEnabled && snippets.length > 0) {
        this.contextCache.set(cacheKey, cloneSnippets(snippets), this.ttlMs);
      }

      return {
        snippets,
        metadata,
      };
    } catch (error) {
      const awsError = error as AwsServiceError;
      metadata.retryCount = awsError?.retries ?? metadata.retryCount ?? 0;
      metadata.degraded = isThrottleError(awsError);

      return {
        snippets: [],
        metadata,
        error: awsError,
      };
    }
  }

  async askKnowledgeBase(
    params: {
      prompt: string;
      sessionId?: string;
      guardrail: GuardrailConfiguration;
      intent?: string;
    }
  ): Promise<KnowledgeBaseAnswer> {
    const normalizedPrompt = params.prompt.trim();
    const allowCache = this.cacheEnabled && !params.sessionId;

    const cacheKey = this.buildCacheKey({
      intent: params.intent ?? (params.guardrail.guardrailId || "default"),
      prompt: normalizedPrompt,
      guardrailId: params.guardrail.guardrailId,
      guardrailVersion: params.guardrail.guardrailVersion,
      topK: this.defaultTopK,
    });

    if (allowCache) {
      const cached = this.answerCache.get(cacheKey);
      if (cached) {
        return {
          ...this.cloneResponse(cached),
          metadata: { retryCount: 0, cacheHit: true, degraded: false },
        };
      }
    }

    try {
      const rawResponse = await this.bedrock.askKb(
        normalizedPrompt,
        params.sessionId,
        {
          guardrailOverride: params.guardrail,
        }
      );

      const retryCount = (rawResponse as any)?.retryCount ?? 0;
      const response = this.cloneResponse(rawResponse);
      const metadata: KnowledgeBaseTelemetry = {
        retryCount,
        cacheHit: false,
        degraded: false,
      };

      if (allowCache) {
        this.answerCache.set(cacheKey, this.cloneResponse(rawResponse), this.ttlMs);
      }

      return {
        ...response,
        metadata,
      };
    } catch (error) {
      const awsError = error as AwsServiceError;

      if (isThrottleError(awsError)) {
        const degraded = this.buildDegradedResponse(
          normalizedPrompt,
          params.sessionId
        );
        degraded.metadata.retryCount = awsError?.retries ?? degraded.metadata.retryCount;
        degraded.error = awsError;
        return degraded;
      }

      throw awsError;
    }
  }

  private buildCacheKey(parts: CacheKeyParts): string {
    return JSON.stringify({
      intent: parts.intent || "default",
      prompt: parts.prompt,
      guardrailId: parts.guardrailId || "default",
      guardrailVersion: parts.guardrailVersion || "default",
      topK: parts.topK,
    });
  }

  private cloneResponse(
    response: BedrockRetrieveAndGenerateResponse
  ): BedrockRetrieveAndGenerateResponse {
    return structuredClone(response);
  }

  private buildDegradedResponse(
    prompt: string,
    sessionId?: string
  ): KnowledgeBaseAnswer {
    const note = truncatePrompt(prompt);

    return {
      output: {
        text: `I'm temporarily unable to retrieve verified knowledge base sources due to throttling. This unsourced, model-only response is provided without citations. Please verify the guidance for "${note}" using official documentation or try again shortly.`,
      },
      citations: [],
      guardrailAction: 'NONE',
      sessionId: sessionId ?? this.generateFallbackSessionId(),
      metadata: {
        retryCount: 0,
        cacheHit: false,
        degraded: true,
      },
    };
  }

  private generateFallbackSessionId(): string {
    return `session-degraded-${randomUUID()}`;
  }
}
