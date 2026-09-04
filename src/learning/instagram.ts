import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { withRetry } from "../utils/retry.js";
import type { InsightMetrics } from "./types.js";

const defaultMetrics = ["reach", "views", "plays", "likes", "saved", "shares", "comments", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"] as const;

interface InstagramMetric {
  name?: unknown;
  values?: unknown;
  total_value?: unknown;
}

function numberValue(metric: InstagramMetric): number | undefined {
  if (Array.isArray(metric.values) && metric.values[0] && typeof metric.values[0] === "object") {
    const value = (metric.values[0] as Record<string, unknown>).value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  if (metric.total_value && typeof metric.total_value === "object") {
    const value = (metric.total_value as Record<string, unknown>).value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function parseMetrics(payload: unknown): InsightMetrics {
  if (!payload || typeof payload !== "object") throw new AppError("INSTAGRAM_API_ERROR", "Instagram Insights 응답 형식이 올바르지 않습니다.");
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) throw new AppError("INSTAGRAM_API_ERROR", "Instagram Insights 응답에 data 배열이 없습니다.");
  const raw: Record<string, number> = {};
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const metric = item as InstagramMetric;
    const name = typeof metric.name === "string" ? metric.name : undefined;
    const value = numberValue(metric);
    if (name && value !== undefined) raw[name] = value;
  }
  return {
    ...(raw.reach === undefined ? {} : { reach: raw.reach }),
    ...(raw.views === undefined ? {} : { views: raw.views }),
    ...(raw.plays === undefined ? {} : { plays: raw.plays }),
    ...(raw.likes === undefined ? {} : { likes: raw.likes }),
    ...(raw.saved === undefined ? {} : { saves: raw.saved }),
    ...(raw.shares === undefined ? {} : { shares: raw.shares }),
    ...(raw.comments === undefined ? {} : { comments: raw.comments }),
    ...(raw.ig_reels_avg_watch_time === undefined ? {} : { avg_watch_time_ms: raw.ig_reels_avg_watch_time }),
    ...(raw.ig_reels_video_view_total_time === undefined ? {} : { total_watch_time_ms: raw.ig_reels_video_view_total_time }),
    ...(raw.reels_skip_rate === undefined ? {} : { skip_rate: raw.reels_skip_rate > 1 ? raw.reels_skip_rate / 100 : raw.reels_skip_rate }),
  };
}

export class InstagramInsightsClient {
  constructor(private readonly config: AppConfig) {}

  async getMediaInsights(mediaId: string, metrics: string[] = [...defaultMetrics]): Promise<InsightMetrics> {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) throw new AppError("INSTAGRAM_TOKEN_MISSING", "INSTAGRAM_ACCESS_TOKEN 환경변수가 필요합니다. 토큰은 로그나 MCP 응답에 포함되지 않습니다.");
    const version = this.config.instagramApiVersion.replaceAll(/[^a-zA-Z0-9.]/g, "");
    const url = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/insights`);
    url.searchParams.set("metric", metrics.join(","));
    return withRetry(async (signal) => {
      const response = await fetch(url, { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      const payload = await response.json().catch(() => undefined) as unknown;
      if (!response.ok) {
        const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
        const message = typeof nested.message === "string" ? nested.message : `HTTP ${response.status}`;
        throw new AppError("INSTAGRAM_API_ERROR", `Instagram Insights 요청이 실패했습니다: ${message}`, response.status === 429 || response.status >= 500);
      }
      return parseMetrics(payload);
    }, { timeoutMs: this.config.instagramTimeoutMs, retries: this.config.instagramRetries, label: "Instagram Insights" });
  }
}
