import { z } from "zod";
import { ISSUE_TYPES } from "../design/attention.js";
import { TEMPLATES } from "../pipeline.js";

const cardId = z.string().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/, "card_id는 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.");
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const learningMetadataSchema = z.object({
  series_id: z.string().min(1).max(120).optional(),
  narrative_role: z.enum(["hook", "context", "evidence", "twist", "climax", "result", "reaction", "cta", "other"]).optional(),
  hero_type: z.enum(["number", "score", "phrase", "player", "icon", "none"]).optional(),
  cta_type: z.enum(["save", "share", "comment", "follow", "none"]).optional(),
  player_occupancy: z.number().min(0).max(1).optional(),
  card_count: z.number().int().min(1).max(50).optional(),
  card_position: z.number().int().min(1).max(50).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).optional(),
}).strict();

export const cardFeaturesSchema = z.object({
  issue_type: z.enum(ISSUE_TYPES),
  template: z.enum(TEMPLATES),
  narrative_role: learningMetadataSchema.shape.narrative_role,
  layout_density: z.enum(["balanced", "dense", "maximum"]),
  visual_intensity: z.number().min(0).max(10),
  include_player: z.boolean(),
  hero_type: learningMetadataSchema.shape.hero_type,
  headline_length: z.number().int().min(0).max(1000),
  headline_lines: z.number().int().min(1).max(20),
  player_occupancy: learningMetadataSchema.shape.player_occupancy,
  card_count: learningMetadataSchema.shape.card_count,
  card_position: learningMetadataSchema.shape.card_position,
  cta_type: learningMetadataSchema.shape.cta_type,
  primary_color: hexColor.optional(),
  accent_color: hexColor.optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).default([]),
}).strict();

export const registerGeneratedCardSchema = z.object({
  card_id: cardId.optional(),
  series_id: z.string().min(1).max(120).optional(),
  output_paths: z.array(z.string().min(1)).min(1).max(50),
  headline: z.string().max(500),
  source: z.enum(["generated", "manual", "reference"]).default("generated"),
  features: cardFeaturesSchema,
  prompt_summary: z.string().max(4000).optional(),
  notes: z.string().max(2000).optional(),
}).strict();

export const registerPublishedCardSchema = z.object({
  card_id: cardId,
  instagram_media_id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
  permalink: z.string().url().max(1000).optional(),
  published_at: z.string().datetime().optional(),
  reel_duration_ms: z.number().int().positive().max(3_600_000).optional(),
}).strict();

export const insightMetricsSchema = z.object({
  reach: z.number().int().nonnegative().optional(),
  views: z.number().int().nonnegative().optional(),
  plays: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  avg_watch_time_ms: z.number().nonnegative().optional(),
  total_watch_time_ms: z.number().nonnegative().optional(),
  skip_rate: z.number().min(0).max(1).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "성과 지표를 하나 이상 입력하세요.");

export const recordCardInsightsSchema = z.object({
  card_id: cardId,
  source: z.enum(["manual_owned", "public_visible"]).default("manual_owned"),
  captured_at: z.string().datetime().optional(),
  metrics: insightMetricsSchema,
}).strict();

const instagramMetric = z.enum(["reach", "views", "plays", "likes", "saved", "shares", "comments", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"]);
export const syncInstagramInsightsSchema = z.object({
  card_id: cardId,
  metrics: z.array(instagramMetric).min(1).max(10).optional(),
}).strict();

export const analyzePerformanceSchema = z.object({
  issue_type: z.enum(ISSUE_TYPES).optional(),
  min_reach: z.number().int().min(1).default(100),
  min_samples: z.number().int().min(2).max(100).default(3),
  min_score_lift: z.number().min(0).max(100).default(5),
}).strict();

export const getRecommendationsSchema = z.object({
  issue_type: z.enum(ISSUE_TYPES),
  min_reach: z.number().int().min(1).default(100),
  min_samples: z.number().int().min(2).max(100).default(3),
  min_score_lift: z.number().min(0).max(100).default(5),
}).strict();

export const adoptRuleSchema = z.object({
  issue_type: z.enum(ISSUE_TYPES),
  settings: z.object({
    template: z.enum(TEMPLATES).optional(),
    layout_density: z.enum(["balanced", "dense", "maximum"]).optional(),
    visual_intensity: z.number().min(0).max(10).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "적용할 설정을 하나 이상 입력하세요."),
  reason: z.string().min(1).max(1000),
  evidence_card_ids: z.array(cardId).max(100).default([]),
  confidence: z.number().min(0).max(1),
  status: z.enum(["hypothesis", "adopted", "retired"]).default("adopted"),
}).strict();

export const experimentSchema = z.object({
  experiment_id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200),
  hypothesis: z.string().min(1).max(1000),
  variable: z.string().min(1).max(120),
  control_card_id: cardId,
  variant_card_ids: z.array(cardId).min(1).max(20),
  status: z.enum(["planned", "running", "completed", "cancelled"]),
  outcome: z.string().max(2000).optional(),
}).strict();

export const generateLearnedPromptSchema = z.object({
  issue_type: z.enum(ISSUE_TYPES),
  issue_summary: z.string().min(1).max(2000),
  available_photo_count: z.number().int().min(0).max(100),
  target_action: z.enum(["save", "share", "comment", "follow", "none"]),
}).strict();
