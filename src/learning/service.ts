import { randomUUID } from "node:crypto";
import type { IssueType } from "../design/attention.js";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";
import { InstagramInsightsClient } from "./instagram.js";
import { recommendFeatures, scoreCards } from "./scoring.js";
import { LearningStore } from "./store.js";
import type { CardDesignFeatures, CardRecord, CtaType, ExperimentRecord, HeroType, InsightMetrics, InsightSnapshot, KnowledgeRule, LearnedSettings, NarrativeRole } from "./types.js";

export interface RegisterCardInput {
  card_id?: string;
  series_id?: string;
  output_paths: string[];
  headline: string;
  source?: CardRecord["source"];
  features: CardDesignFeatures;
  prompt_summary?: string;
  notes?: string;
}

export class LearningService {
  constructor(private readonly store: LearningStore, private readonly instagram: InstagramInsightsClient, private readonly guard: PathGuard) {}

  async registerCard(input: RegisterCardInput): Promise<CardRecord> {
    const outputPaths = await Promise.all(input.output_paths.map((item) => this.guard.readable(item, ["output"])));
    const now = new Date().toISOString();
    const id = input.card_id ?? randomUUID();
    let existing: CardRecord | undefined;
    try { existing = this.store.getCard(id); } catch (error) {
      if (!(error instanceof AppError) || error.code !== "LEARNING_RECORD_NOT_FOUND") throw error;
    }
    const record: CardRecord = {
      id,
      ...(input.series_id ? { series_id: input.series_id } : existing?.series_id ? { series_id: existing.series_id } : {}),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      source: input.source ?? existing?.source ?? "generated",
      output_paths: outputPaths,
      headline: input.headline,
      features: input.features,
      ...(input.prompt_summary ? { prompt_summary: input.prompt_summary } : existing?.prompt_summary ? { prompt_summary: existing.prompt_summary } : {}),
      ...(existing?.instagram_media_id ? { instagram_media_id: existing.instagram_media_id } : {}),
      ...(existing?.instagram_permalink ? { instagram_permalink: existing.instagram_permalink } : {}),
      ...(existing?.published_at ? { published_at: existing.published_at } : {}),
      ...(existing?.reel_duration_ms ? { reel_duration_ms: existing.reel_duration_ms } : {}),
      ...(input.notes ? { notes: input.notes } : existing?.notes ? { notes: existing.notes } : {}),
    };
    return this.store.upsertCard(record);
  }

  async registerPublished(input: { card_id: string; instagram_media_id: string; permalink?: string; published_at?: string; reel_duration_ms?: number }): Promise<CardRecord> {
    const existing = this.store.getCard(input.card_id);
    const record: CardRecord = {
      ...existing,
      instagram_media_id: input.instagram_media_id,
      ...(input.permalink ? { instagram_permalink: input.permalink } : {}),
      published_at: input.published_at ?? existing.published_at ?? new Date().toISOString(),
      ...(input.reel_duration_ms === undefined ? {} : { reel_duration_ms: input.reel_duration_ms }),
      updated_at: new Date().toISOString(),
    };
    return this.store.upsertCard(record);
  }

  async recordInsights(input: { card_id: string; source: InsightSnapshot["source"]; captured_at?: string; metrics: InsightMetrics }): Promise<InsightSnapshot> {
    const card = this.store.getCard(input.card_id);
    const snapshot: InsightSnapshot = {
      id: randomUUID(),
      card_id: card.id,
      ...(card.instagram_media_id ? { instagram_media_id: card.instagram_media_id } : {}),
      captured_at: input.captured_at ?? new Date().toISOString(),
      source: input.source,
      metrics: input.metrics,
    };
    return this.store.addInsight(snapshot);
  }

  async syncInstagram(input: { card_id: string; metrics?: string[] }): Promise<InsightSnapshot> {
    const card = this.store.getCard(input.card_id);
    if (!card.instagram_media_id) throw new AppError("INVALID_ARGUMENT", "먼저 register_published_card로 Instagram 미디어 ID를 연결하세요.");
    const metrics = await this.instagram.getMediaInsights(card.instagram_media_id, input.metrics);
    return this.recordInsights({ card_id: card.id, source: "instagram_api", metrics });
  }

  analyze(input: { issue_type?: IssueType; min_reach: number; min_samples: number; min_score_lift: number }): Record<string, unknown> {
    const database = this.store.snapshot();
    const scored = scoreCards(database.cards, database.insights, { minReach: input.min_reach, ...(input.issue_type ? { issueType: input.issue_type } : {}) });
    const recommendations = recommendFeatures(scored, input.min_samples, input.min_score_lift);
    return {
      issue_type: input.issue_type ?? "all",
      eligible_cards: scored.length,
      min_reach: input.min_reach,
      score_weights: { saves: 35, shares: 30, watch_quality: 15, likes: 10, comments: 5, skip_quality: 5 },
      top_cards: scored.slice(0, 10).map((item) => ({
        card_id: item.card.id,
        headline: item.card.headline,
        score: item.score,
        rates: item.rates,
        features: item.card.features,
      })),
      recommendations,
      warning: scored.length < input.min_samples * 2 ? "표본이 적어 결과는 관찰 단계로만 사용하세요." : undefined,
    };
  }

  getRecommendations(input: { issue_type: IssueType; min_reach: number; min_samples: number; min_score_lift: number }): Record<string, unknown> {
    const analysis = this.analyze(input);
    const adoptedRules = this.store.listRules().filter((rule) => rule.issue_type === input.issue_type && rule.status === "adopted");
    return { ...analysis, adopted_rules: adoptedRules, applied_defaults: this.appliedDefaults(input.issue_type) };
  }

  async adoptRule(input: { issue_type: IssueType; settings: LearnedSettings; reason: string; evidence_card_ids: string[]; confidence: number; status?: KnowledgeRule["status"] }): Promise<KnowledgeRule> {
    for (const cardId of input.evidence_card_ids) this.store.getCard(cardId);
    const now = new Date().toISOString();
    const rule: KnowledgeRule = {
      id: randomUUID(),
      issue_type: input.issue_type,
      settings: input.settings,
      reason: input.reason,
      evidence_card_ids: input.evidence_card_ids,
      evidence_count: input.evidence_card_ids.length,
      confidence: input.confidence,
      status: input.status ?? "adopted",
      created_at: now,
      updated_at: now,
    };
    return this.store.upsertRule(rule);
  }

  appliedDefaults(issueType: IssueType): LearnedSettings & { rule_ids: string[] } {
    const rules = this.store.listRules().filter((rule) => rule.issue_type === issueType && rule.status === "adopted").sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return rules.reduce<LearnedSettings & { rule_ids: string[] }>((result, rule) => ({ ...result, ...rule.settings, rule_ids: [...result.rule_ids, rule.id] }), { rule_ids: [] });
  }

  async recordExperiment(input: { experiment_id?: string; name: string; hypothesis: string; variable: string; control_card_id: string; variant_card_ids: string[]; status: ExperimentRecord["status"]; outcome?: string }): Promise<ExperimentRecord> {
    this.store.getCard(input.control_card_id);
    for (const cardId of input.variant_card_ids) this.store.getCard(cardId);
    const now = new Date().toISOString();
    const record: ExperimentRecord = {
      id: input.experiment_id ?? randomUUID(),
      name: input.name,
      hypothesis: input.hypothesis,
      variable: input.variable,
      control_card_id: input.control_card_id,
      variant_card_ids: input.variant_card_ids,
      status: input.status,
      created_at: now,
      updated_at: now,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    };
    return this.store.upsertExperiment(record);
  }

  generatePrompt(input: { issue_type: IssueType; issue_summary: string; available_photo_count: number; target_action: CtaType }): Record<string, unknown> {
    const defaults = this.appliedDefaults(input.issue_type);
    const recommendations = this.getRecommendations({ issue_type: input.issue_type, min_reach: 100, min_samples: 3, min_score_lift: 5 });
    const lines = [
      `이슈: ${input.issue_summary}`,
      `이슈 유형: ${input.issue_type}`,
      `제공 사진 수: ${input.available_photo_count}장. 사진 수를 카드 수로 간주하지 말고 서사에 필요한 카드 수를 판단할 것.`,
      `목표 행동: ${input.target_action}`,
      defaults.template ? `검증된 기본 템플릿: ${defaults.template}` : "템플릿: auto로 시작할 것.",
      defaults.layout_density ? `검증된 레이아웃 밀도: ${defaults.layout_density}` : "레이아웃 밀도는 이슈 강도에 따라 결정할 것.",
      defaults.visual_intensity === undefined ? "시각 강도는 이슈에 따라 결정할 것." : `검증된 시각 강도: ${defaults.visual_intensity}/10`,
      "선수 원본은 AI 배경에 전달하지 말고 모든 글자와 숫자는 로컬 SVG로 렌더링할 것.",
      "각 카드는 새로운 정보 또는 감정적 진전을 가져야 하며 중복 카드가 생기기 시작하면 멈출 것.",
    ];
    return { prompt_addendum: lines.join("\n"), applied_defaults: defaults, evidence: recommendations };
  }

  static featuresFromGeneration(input: {
    issue_type: IssueType;
    template: CardDesignFeatures["template"];
    layout_density: CardDesignFeatures["layout_density"];
    visual_intensity: number;
    include_player: boolean;
    headline: string;
    narrative_role?: NarrativeRole;
    hero_type?: HeroType;
    cta_type?: CtaType;
    player_occupancy?: number;
    card_count?: number;
    card_position?: number;
    primary_color?: string;
    accent_color?: string;
    tags?: string[];
  }): CardDesignFeatures {
    return {
      issue_type: input.issue_type,
      template: input.template,
      layout_density: input.layout_density,
      visual_intensity: input.visual_intensity,
      include_player: input.include_player,
      headline_length: Array.from(input.headline.replaceAll(/\s/g, "")).length,
      headline_lines: input.headline.split("\n").length,
      tags: input.tags ?? [],
      ...(input.narrative_role ? { narrative_role: input.narrative_role } : {}),
      ...(input.hero_type ? { hero_type: input.hero_type } : {}),
      ...(input.cta_type ? { cta_type: input.cta_type } : {}),
      ...(input.player_occupancy === undefined ? {} : { player_occupancy: input.player_occupancy }),
      ...(input.card_count === undefined ? {} : { card_count: input.card_count }),
      ...(input.card_position === undefined ? {} : { card_position: input.card_position }),
      ...(input.primary_color ? { primary_color: input.primary_color } : {}),
      ...(input.accent_color ? { accent_color: input.accent_color } : {}),
    };
  }
}
