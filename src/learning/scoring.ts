import type { CardRecord, FeatureRecommendation, InsightSnapshot, PerformanceRates, ScoredCard } from "./types.js";

const weights: Record<keyof PerformanceRates, number> = {
  save_rate: 35,
  share_rate: 30,
  watch_quality: 15,
  like_rate: 10,
  comment_rate: 5,
  skip_quality: 5,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function denominator(snapshot: InsightSnapshot): number {
  return Math.max(1, snapshot.metrics.reach ?? snapshot.metrics.views ?? snapshot.metrics.plays ?? 0);
}

function rates(card: CardRecord, snapshot: InsightSnapshot): PerformanceRates {
  const base = denominator(snapshot);
  const duration = Math.max(1, card.reel_duration_ms ?? 0);
  const hasDuration = Boolean(card.reel_duration_ms && card.reel_duration_ms > 0);
  return {
    save_rate: clamp((snapshot.metrics.saves ?? 0) / base),
    share_rate: clamp((snapshot.metrics.shares ?? 0) / base),
    like_rate: clamp((snapshot.metrics.likes ?? 0) / base),
    comment_rate: clamp((snapshot.metrics.comments ?? 0) / base),
    watch_quality: hasDuration ? clamp((snapshot.metrics.avg_watch_time_ms ?? 0) / duration) : 0,
    skip_quality: snapshot.metrics.skip_rate === undefined ? 0 : 1 - clamp(snapshot.metrics.skip_rate),
  };
}

function percentile(value: number, values: number[]): number {
  if (values.length <= 1) return 0.5;
  const lower = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (lower + Math.max(0, equal - 1) / 2) / (values.length - 1);
}

export function latestInsights(insights: InsightSnapshot[], allowPublicVisible = false): Map<string, InsightSnapshot> {
  const latest = new Map<string, InsightSnapshot>();
  for (const snapshot of insights) {
    if (!allowPublicVisible && snapshot.source === "public_visible") continue;
    const current = latest.get(snapshot.card_id);
    if (!current || current.captured_at < snapshot.captured_at) latest.set(snapshot.card_id, snapshot);
  }
  return latest;
}

export function scoreCards(cards: CardRecord[], insights: InsightSnapshot[], options: { minReach: number; issueType?: string }): ScoredCard[] {
  const latest = latestInsights(insights);
  const eligible = cards.flatMap((card) => {
    if (options.issueType && card.features.issue_type !== options.issueType) return [];
    const snapshot = latest.get(card.id);
    if (!snapshot || denominator(snapshot) < options.minReach) return [];
    return [{ card, snapshot, rates: rates(card, snapshot) }];
  });
  const vectors = Object.fromEntries((Object.keys(weights) as Array<keyof PerformanceRates>).map((key) => [key, eligible.map((item) => item.rates[key])])) as Record<keyof PerformanceRates, number[]>;
  return eligible.map((item) => {
    const score = (Object.keys(weights) as Array<keyof PerformanceRates>).reduce((total, key) => total + weights[key] * percentile(item.rates[key], vectors[key]), 0);
    return { ...item, score: Number(score.toFixed(2)) };
  }).sort((a, b) => b.score - a.score);
}

function bucketNumber(value: number | undefined, boundaries: [number, string][], fallback: string): string {
  if (value === undefined) return fallback;
  for (const [boundary, label] of boundaries) if (value <= boundary) return label;
  return boundaries.at(-1)?.[1] ?? fallback;
}

function features(card: CardRecord): Record<string, string> {
  return {
    template: card.features.template,
    layout_density: card.features.layout_density,
    include_player: String(card.features.include_player),
    hero_type: card.features.hero_type ?? "unknown",
    narrative_role: card.features.narrative_role ?? "unknown",
    cta_type: card.features.cta_type ?? "none",
    headline_lines: String(card.features.headline_lines),
    headline_length_bucket: bucketNumber(card.features.headline_length, [[8, "short"], [16, "medium"], [999, "long"]], "unknown"),
    visual_intensity_bucket: bucketNumber(card.features.visual_intensity, [[4, "low"], [7, "medium"], [10, "high"]], "unknown"),
    player_occupancy_bucket: bucketNumber(card.features.player_occupancy, [[0.4, "small"], [0.62, "medium"], [1, "large"]], "unknown"),
    card_count_bucket: bucketNumber(card.features.card_count, [[2, "short"], [5, "medium"], [99, "long"]], "unknown"),
  };
}

export function recommendFeatures(scored: ScoredCard[], minSamples: number, minLift: number): FeatureRecommendation[] {
  const featureNames = scored.length ? Object.keys(features(scored[0]!.card)) : [];
  const recommendations: FeatureRecommendation[] = [];
  for (const feature of featureNames) {
    const groups = new Map<string, ScoredCard[]>();
    for (const item of scored) {
      const value = features(item.card)[feature] ?? "unknown";
      if (value === "unknown") continue;
      groups.set(value, [...(groups.get(value) ?? []), item]);
    }
    const eligible = [...groups.entries()].filter(([, items]) => items.length >= minSamples).map(([value, items]) => ({
      value,
      items,
      average: items.reduce((sum, item) => sum + item.score, 0) / items.length,
    })).sort((a, b) => b.average - a.average);
    const best = eligible[0];
    const comparison = eligible.at(-1);
    if (!best || !comparison || best.value === comparison.value) continue;
    const lift = best.average - comparison.average;
    if (lift < minLift) continue;
    const evidence = best.items.map((item) => item.card.id);
    recommendations.push({
      feature,
      preferred_value: best.value,
      compared_value: comparison.value,
      preferred_sample_count: best.items.length,
      compared_sample_count: comparison.items.length,
      score_lift: Number(lift.toFixed(2)),
      confidence: Number(Math.min(0.95, 0.5 + Math.min(best.items.length, comparison.items.length) * 0.04 + lift / 200).toFixed(2)),
      evidence_card_ids: evidence,
    });
  }
  return recommendations.sort((a, b) => b.score_lift - a.score_lift);
}
