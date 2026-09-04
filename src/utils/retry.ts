import { AppError } from "../errors.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryable(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  const text = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|429|rate limit|5\d\d|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(text);
}

export async function withRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; retries: number; label: string },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const timeout = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new AppError("API_TIMEOUT", `${options.label} 요청 시간이 초과되었습니다.`, true)));
      });
      return await Promise.race([operation(controller.signal), timeout]);
    } catch (error) {
      const normalized = controller.signal.aborted && !(error instanceof AppError && error.code === "API_TIMEOUT")
        ? new AppError("API_TIMEOUT", `${options.label} 요청 시간이 초과되었습니다.`, true)
        : error;
      lastError = normalized;
      if (attempt >= options.retries || !retryable(normalized)) throw normalized;
      await sleep(Math.min(500 * 2 ** attempt, 4_000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AppError("API_RETRY_EXHAUSTED", `${options.label} 요청 재시도 횟수를 초과했습니다: ${String(lastError)}`, true);
}
