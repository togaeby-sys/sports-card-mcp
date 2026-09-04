import type { IssueType, LayoutDensity } from "../design/attention.js";
import type { Template } from "../pipeline.js";

export type NarrativeRole = "hook" | "context" | "evidence" | "twist" | "climax" | "result" | "reaction" | "cta" | "other";
export type HeroType = "number" | "score" | "phrase" | "player" | "icon" | "none";
export type CtaType = "save" | "share" | "comment" | "follow" | "none";

export interface CardDesignFeatures {
  issue_type: IssueType;
  template: Template;
  narrative_role?: NarrativeRole;
  layout_density: LayoutDensity;
  visual_intensity: number;
  include_player: boolean;
  hero_type?: HeroType;
  headline_length: number;
  headline_lines: number;
  player_occupancy?: number;
  card_count?: number;
  card_position?: number;
  cta_type?: CtaType;
  primary_color?: string;
  accent_color?: string;
  tags: string[];
}

export interface CardRecord {
  id: string;
  series_id?: string;
  created_at: string;
  updated_at: string;
  source: "generated" | "manual" | "reference";
  output_paths: string[];
  headline: string;
  features: CardDesignFeatures;
  prompt_summary?: string;
  instagram_media_id?: string;
  instagram_permalink?: string;
  published_at?: string;
  reel_duration_ms?: number;
  notes?: string;
}

export interface InsightMetrics {
  reach?: number;
  views?: number;
  plays?: number;
  likes?: number;
  saves?: number;
  shares?: number;
  comments?: number;
  avg_watch_time_ms?: number;
  total_watch_time_ms?: number;
  skip_rate?: number;
}

export interface InsightSnapshot {
  id: string;
  card_id: string;
  instagram_media_id?: string;
  captured_at: string;
  source: "instagram_api" | "manual_owned" | "public_visible";
  metrics: InsightMetrics;
}

export interface ExperimentRecord {
  id: string;
  name: string;
  hypothesis: string;
  variable: string;
  control_card_id: string;
  variant_card_ids: string[];
  status: "planned" | "running" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  outcome?: string;
}

export interface LearnedSettings {
  template?: Template;
  layout_density?: LayoutDensity;
  visual_intensity?: number;
}

export interface KnowledgeRule {
  id: string;
  issue_type: IssueType;
  settings: LearnedSettings;
  reason: string;
  evidence_card_ids: string[];
  evidence_count: number;
  confidence: number;
  status: "hypothesis" | "adopted" | "retired";
  created_at: string;
  updated_at: string;
}

export interface LearningDatabase {
  version: 1;
  cards: CardRecord[];
  insights: InsightSnapshot[];
  experiments: ExperimentRecord[];
  rules: KnowledgeRule[];
}

export interface PerformanceRates {
  save_rate: number;
  share_rate: number;
  like_rate: number;
  comment_rate: number;
  watch_quality: number;
  skip_quality: number;
}

export interface ScoredCard {
  card: CardRecord;
  snapshot: InsightSnapshot;
  rates: PerformanceRates;
  score: number;
}

export interface FeatureRecommendation {
  feature: string;
  preferred_value: string;
  compared_value: string;
  preferred_sample_count: number;
  compared_sample_count: number;
  score_lift: number;
  confidence: number;
  evidence_card_ids: string[];
}
