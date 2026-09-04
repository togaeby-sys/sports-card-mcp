function sanitize(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [process.env.FAL_KEY, process.env.INSTAGRAM_ACCESS_TOKEN]
    .filter((secret): secret is string => Boolean(secret))
    .reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), text);
}

export const logger = {
  info(message: string, details?: unknown): void {
    process.stderr.write(`[sports-card-mcp] ${sanitize(message)}${details === undefined ? "" : ` ${sanitize(details)}`}\n`);
  },
  error(message: string, details?: unknown): void {
    process.stderr.write(`[sports-card-mcp:error] ${sanitize(message)}${details === undefined ? "" : ` ${sanitize(details)}`}\n`);
  },
};
