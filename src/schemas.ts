import { z } from "zod";
import { POSTER_STYLES, TEMPLATES } from "./pipeline.js";
import { ISSUE_TYPES } from "./design/attention.js";
import { learningMetadataSchema } from "./learning/schemas.js";
import { CARD_ROLES, LAYOUT_FAMILIES } from "./series/director.js";

const createTemplateChoices = [...TEMPLATES, "auto"] as const;
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "색상은 #RRGGBB 형식이어야 합니다.");

export const safeAreaSchema = z.object({
  x: z.number().int().min(0).max(1079),
  y: z.number().int().min(0).max(1919),
  width: z.number().int().positive().max(1080),
  height: z.number().int().positive().max(1920),
}).strict().refine((value) => value.x + value.width <= 1080 && value.y + value.height <= 1920, "text_safe_area가 1080×1920 캔버스를 벗어납니다.");

const anchorSchema = z.enum(["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"]);
const shadowSchema = z.union([z.boolean(), z.object({
  color: z.string().default("#000000"),
  opacity: z.number().min(0).max(1).default(0.65),
  blur: z.number().min(0).max(100).default(18),
  offset_x: z.number().min(-500).max(500).default(14),
  offset_y: z.number().min(-500).max(500).default(22),
}).strict()]);
const rimSchema = z.union([z.boolean(), z.object({
  color: z.string().default("#ffffff"),
  opacity: z.number().min(0).max(1).default(0.55),
  width: z.number().min(0).max(100).default(7),
}).strict()]);

export const analyzeSchema = z.object({ image_path: z.string().min(1) }).strict();
export const extractSchema = z.object({
  input_image: z.string().min(1),
  output_path: z.string().min(1),
  force: z.boolean().optional(),
  learning_metadata: learningMetadataSchema.optional(),
}).strict();
export const backgroundSchema = z.object({
  theme: z.string().min(1).max(1000),
  stadium_type: z.string().min(1).max(300),
  lighting: z.string().min(1).max(300),
  team_color: z.string().min(1).max(100),
  intensity: z.number().min(0).max(10),
  text_safe_area: safeAreaSchema,
  aspect_ratio: z.enum(["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"]),
  seed: z.number().int().nonnegative().optional(),
  output_path: z.string().min(1),
  reuse_background_path: z.string().min(1).optional(),
  force: z.boolean().optional(),
}).strict();
export const posterPlateSchema = z.object({
  kicker: z.string().min(1).max(80),
  headline: z.string().min(1).max(120),
  player_name: z.string().max(80).default(""),
  jersey_number: z.string().max(12).optional(),
  hero_number: z.string().max(12).optional(),
  subheadline: z.string().min(1).max(160),
  english_tagline: z.string().min(1).max(100),
  team_color: hexColorSchema,
  accent_color: hexColorSchema,
  intensity: z.number().min(0).max(10).default(9),
  narrative_role: z.enum(CARD_ROLES).optional(),
  layout_family: z.enum(LAYOUT_FAMILIES).optional(),
  layout_direction: z.string().max(1500).optional(),
  subject_slots: z.number().int().min(0).max(2).optional(),
  footer: z.string().max(160).optional(),
  context_prompt: z.string().max(2000).optional(),
  output_path: z.string().min(1),
  reference_path: z.string().min(1).optional(),
  reuse_poster_path: z.string().min(1).optional(),
  seed: z.number().int().nonnegative().optional(),
  force: z.boolean().optional(),
}).strict();
export const compositeSchema = z.object({
  player_png: z.string().min(1),
  background_image: z.string().min(1),
  x: z.number().min(-5000).max(5000),
  y: z.number().min(-5000).max(5000),
  scale: z.number().min(0.05).max(5),
  rotation: z.number().min(-360).max(360),
  anchor: anchorSchema,
  shadow: shadowSchema,
  rim_light: rimSchema,
  output_path: z.string().min(1),
}).strict();
export const effectSchema = z.object({
  input_image: z.string().min(1),
  output_path: z.string().min(1),
  theme: z.enum(TEMPLATES).optional(),
  team_color: hexColorSchema.optional(),
  intensity: z.number().min(0).max(10).optional(),
  seed: z.number().int().nonnegative().optional(),
  attention_mode: z.boolean().optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "accent_color는 #RRGGBB 형식이어야 합니다.").optional(),
  density: z.enum(["balanced", "dense", "maximum"]).optional(),
}).strict();

const textBlockSchema = z.object({
  text: z.string().max(500),
  x: z.number().min(-5000).max(5000),
  y: z.number().min(-5000).max(5000),
  width: z.number().positive().max(5000),
  font_size: z.number().positive().max(500),
  font_weight: z.number().int().min(100).max(1000),
  align: z.enum(["left", "center", "right"]),
  color: z.string().optional(),
  line_height: z.number().min(0.5).max(3).optional(),
  stroke: z.union([z.string(), z.object({ color: z.string(), width: z.number().min(0).max(50) }).strict()]).optional(),
  shadow: shadowSchema.optional(),
  style_preset: z.enum(["clean", "impact_white", "impact_gold", "impact_orange"]).optional(),
  font_style: z.enum(["normal", "italic"]).optional(),
  letter_spacing: z.number().min(-20).max(50).optional(),
  font_path: z.string().min(1).optional(),
  scale_x: z.number().min(0.5).max(1.5).optional(),
  skew_x: z.number().min(-25).max(25).optional(),
  opacity: z.number().min(0).max(1).optional(),
  plate: z.object({
    fill: z.string(),
    opacity: z.number().min(0).max(1).optional(),
    border_color: z.string().optional(),
    border_width: z.number().min(0).max(20).optional(),
    padding_x: z.number().min(0).max(200).optional(),
    padding_y: z.number().min(0).max(100).optional(),
    radius: z.number().min(0).max(100).optional(),
    cut_corners: z.boolean().optional(),
  }).strict().optional(),
}).strict();
export const renderTextSchema = z.object({
  input_image: z.string().min(1),
  output_path: z.string().min(1),
  font_path: z.string().min(1),
  text_blocks: z.array(textBlockSchema).max(30),
}).strict();
export const exportSchema = z.object({
  input_image: z.string().min(1),
  output_path: z.string().min(1),
}).strict();
export const createSchema = z.object({
  player_image: z.string().min(1),
  output_path: z.string().min(1),
  template: z.enum(createTemplateChoices).default("auto"),
  poster_style: z.enum(POSTER_STYLES).default("auto"),
  poster_kicker: z.string().max(80).optional(),
  english_tagline: z.string().max(100).optional(),
  poster_reference_path: z.string().min(1).optional(),
  issue_type: z.enum(ISSUE_TYPES).default("generic"),
  background_prompt: z.string().max(2000).default(""),
  team_color: hexColorSchema,
  secondary_color: hexColorSchema.optional(),
  accent_color: hexColorSchema.optional(),
  season: z.string().max(40).optional(),
  league_label: z.string().max(40).default("KBO"),
  team_name: z.string().max(80).optional(),
  player_name: z.string().max(80).optional(),
  jersey_number: z.string().max(12).optional(),
  headline: z.string().min(1).max(300),
  score_text: z.string().max(200).default(""),
  subheadline: z.string().max(300).default(""),
  callout: z.string().max(180).optional(),
  fact_lines: z.array(z.string().max(120)).max(4).optional(),
  footer: z.string().max(300).default(""),
  visual_intensity: z.number().min(0).max(10).optional(),
  layout_density: z.enum(["balanced", "dense", "maximum"]).optional(),
  player_position: z.object({
    x: z.number().min(-5000).max(5000),
    y: z.number().min(-5000).max(5000),
    scale: z.number().min(0.05).max(5),
    rotation: z.number().min(-360).max(360).optional(),
    anchor: anchorSchema.optional(),
  }).strict().optional(),
  text_safe_area: safeAreaSchema.default({ x: 60, y: 50, width: 960, height: 1810 }),
  seed: z.number().int().nonnegative().optional(),
  font_path: z.string().min(1).optional(),
  reuse_background_path: z.string().min(1).optional(),
  reuse_poster_path: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
}).strict();

const seriesPhotoSchema = z.object({
  image_path: z.string().min(1),
  label: z.string().max(120).optional(),
  preferred_roles: z.array(z.enum(CARD_ROLES)).max(5).optional(),
}).strict();

const seriesCardSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, "카드 id는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.").optional(),
  role: z.enum(CARD_ROLES),
  kicker: z.string().max(80).optional(),
  headline: z.string().min(1).max(120),
  hero_number: z.string().max(20).optional(),
  player_name: z.string().max(80).optional(),
  jersey_number: z.string().max(12).optional(),
  subheadline: z.string().min(1).max(160),
  english_tagline: z.string().max(100).optional(),
  footer: z.string().max(160).optional(),
  background_prompt: z.string().max(1200).optional(),
  include_player: z.enum(["auto", "yes", "no"]).default("auto"),
  photo_indices: z.array(z.number().int().nonnegative()).max(2).optional(),
  layout_family: z.enum(LAYOUT_FAMILIES).optional(),
  poster_reference_path: z.string().min(1).optional(),
  reuse_poster_path: z.string().min(1).optional(),
  typography_verified: z.boolean().default(false),
  seed: z.number().int().nonnegative().optional(),
}).strict();

export const createSeriesSchema = z.object({
  series_id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "series_id는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다."),
  output_dir: z.string().min(1),
  topic: z.string().min(1).max(300),
  issue_summary: z.string().min(1).max(1500),
  issue_type: z.enum(ISSUE_TYPES).default("generic"),
  season: z.string().max(40).optional(),
  league_label: z.string().max(40).default("KBO"),
  team_name: z.string().max(80).optional(),
  team_color: hexColorSchema,
  accent_color: hexColorSchema.optional(),
  template: z.enum(createTemplateChoices).default("auto"),
  render_provider: z.enum(["chatgpt_ui", "gpt_app", "manual_gpt_app", "fal_api"]).default("chatgpt_ui").describe("기본 chatgpt_ui는 Chrome의 ChatGPT를 자동 조작합니다. gpt_app은 같은 자동 경로의 호환 별칭이고, manual_gpt_app은 작업 파일만 만들며, fal_api는 명시한 경우에만 사용합니다."),
  photos: z.array(seriesPhotoSchema).max(12).default([]),
  cards: z.array(seriesCardSchema).min(1).max(12),
  retry_cards: z.array(z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)).max(12).optional(),
  dry_run: z.boolean().optional(),
  force: z.boolean().optional(),
}).strict();

export const importGptAppCardSchema = z.object({
  job_manifest: z.string().min(1).describe("prepare_gpt_app_reels가 반환한 output 폴더 내 절대 JSON 경로"),
  card_id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  generated_image: z.string().min(1).describe("GPT 앱에서 저장한 결과 이미지의 허용 폴더 내 절대 경로"),
  exact_text_verified: z.boolean().default(false).describe("작업 명세와 모든 한글·숫자·영문이 정확히 일치함을 사람이 확인했는지 여부"),
  no_generated_people_verified: z.boolean().default(false).describe("포스터 판에 사람·선수·신체·실루엣이 생성되지 않았음을 사람이 확인했는지 여부"),
  force: z.boolean().optional(),
}).strict();

export const gptAppJobSchema = z.object({
  job_manifest: z.string().min(1).describe("prepare_gpt_app_reels가 반환한 output 폴더 내 절대 JSON 경로"),
}).strict();

export const setupChatGptUiSchema = z.object({
  wait_for_login_ms: z.number().int().min(0).max(300_000).default(0).describe("로그인 완료를 기다릴 최대 시간. 0이면 현재 상태만 확인합니다."),
}).strict();
