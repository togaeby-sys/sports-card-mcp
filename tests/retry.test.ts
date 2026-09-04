import { describe, expect, it } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("remote timeout and retry", () => {
  it("aborts timed-out operations, retries, and returns a structured timeout code", async () => {
    let attempts = 0;
    await expect(withRetry(async (signal) => {
      attempts += 1;
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return "never";
    }, { timeoutMs: 10, retries: 1, label: "test API" })).rejects.toMatchObject({ code: "API_TIMEOUT", retryable: true });
    expect(attempts).toBe(2);
  });
});
