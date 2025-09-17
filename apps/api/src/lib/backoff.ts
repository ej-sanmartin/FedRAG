import type { AwsServiceError } from "../types.js";

export interface BackoffOptions<TError = unknown> {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: TError) => boolean;
  onRetry?: (params: { error: TError; attempt: number; delayMs: number }) => void;
}

export interface BackoffResult<TResult> {
  result: TResult;
  retries: number;
}

const DEFAULT_MAX_RETRIES = parseEnvInt(process.env.KB_MAX_RETRIES, 3);
const DEFAULT_BASE_DELAY_MS = parseEnvInt(process.env.KB_BACKOFF_BASE_MS, 200);
const DEFAULT_MAX_DELAY_MS = Math.max(
  DEFAULT_BASE_DELAY_MS,
  parseEnvInt(process.env.KB_BACKOFF_MAX_MS, 2000)
);

function parseEnvInt(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function defaultShouldRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Partial<AwsServiceError> & {
    $metadata?: { httpStatusCode?: number };
    name?: string;
    code?: string;
    statusCode?: number;
    retryable?: boolean;
  };

  const statusCode = candidate.$metadata?.httpStatusCode ?? candidate.statusCode;

  if (statusCode === 429) {
    return true;
  }

  const code = (candidate.code ?? candidate.name ?? "").toString().toLowerCase();

  if (!code) {
    return Boolean(candidate.retryable);
  }

  return (
    code.includes("throttling") ||
    code.includes("too_many_requests") ||
    code.includes("toomanyrequests") ||
    Boolean(candidate.retryable)
  );
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function withBackoff<TResult, TError = unknown>(
  operation: () => Promise<TResult>,
  options: BackoffOptions<TError> = {}
): Promise<BackoffResult<TResult>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = Math.max(
    baseDelayMs,
    options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  );
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let retries = 0;

  // Attempt the operation with exponential backoff and full jitter
  // See https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ for guidance
  // We cap the retries to prevent unbounded execution in Lambda environments.
  for (;;) {
    try {
      const result = await operation();
      return { result, retries };
    } catch (error) {
      const canRetry = shouldRetry(error as TError);

      if (!canRetry || retries >= maxRetries) {
        if (error && typeof error === "object") {
          Object.defineProperty(error, "retries", {
            value: retries,
            enumerable: false,
            configurable: true,
          });
        }

        throw error;
      }

      const exponentialDelay = baseDelayMs * 2 ** retries;
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
      const jitterDelay = Math.random() * cappedDelay;

      options.onRetry?.({
        error: error as TError,
        attempt: retries + 1,
        delayMs: jitterDelay,
      });

      retries += 1;
      await wait(jitterDelay);
    }
  }
}
