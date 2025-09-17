import { describe, it, expect, vi } from 'vitest';

import { withBackoff } from '../../../src/lib/backoff.js';

describe('withBackoff', () => {
  it('retries a failing operation until it succeeds when the error is retryable', async () => {
    const operation = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue('success');

    const shouldRetry = vi.fn().mockReturnValue(true);

    const result = await withBackoff(operation, {
      maxRetries: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      shouldRetry,
    });

    expect(result).toEqual({ result: 'success', retries: 1 });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('throws the last error with the retry count when retries are exhausted', async () => {
    const terminalError = new Error('persistent failure');
    const operation = vi.fn<[], Promise<string>>().mockRejectedValue(terminalError);
    const shouldRetry = vi.fn().mockReturnValue(true);

    await expect(
      withBackoff(operation, {
        maxRetries: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
        shouldRetry,
      })
    ).rejects.toBe(terminalError);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(shouldRetry).toHaveBeenCalledTimes(3);
    expect((terminalError as any).retries).toBe(2);
  });
});
