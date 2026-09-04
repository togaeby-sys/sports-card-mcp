import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AppConfig } from "./config.js";
import type { FileCache } from "./cache.js";
import { AppError } from "./errors.js";
import { analyzeImage } from "./image/analyze.js";
import { addAttentionUnderlay } from "./image/attention.js";
import { generateSportsBackground, makeBackgroundPrompt, type BackgroundInput } from "./image/background.js";
import { compositePlayer, type Anchor } from "./image/composite.js";
import { addEffectOverlay } from "./image/effects.js";
import { exportReelsCard } from "./image/export.js";
import { extractPlayer } from "./image/extract.js";
import { renderCardText, type TextBlock } from "./image/text.js";
import { generatePosterPlate, makePosterPlatePrompt, posterPlateCacheKey, type PosterPlateInput } from "./image/poster.js";
import { inspectCardImage } from "./image/quality.js";
import type { BackgroundProvider, SegmentationProvider } from "./providers/types.js";
import type { PathGuard } from "./security/paths.js";
import { hashObject } from "./utils/hash.js";
import { resolveAttentionStrategy, type AttentionStrategy, type IssueType, type LayoutDensity } from "./design/attention.js";
import { LearningService } from "./learning/service.js";
import type { CtaType, HeroType, NarrativeRole } from "./learning/types.js";
import { logger } from "./logger.js";

export const TEMPLATES = ["cinematic_red", "championship_gold", "night_stadium", "certificate", "breaking_news"] as const;
export type Template = typeof TEMPLATES[number];
export const POSTER_STYLES = ["auto", "cinematic_poster", "editorial_local"] as const;
export type PosterStyle = typeof POSTER_STYLES[number];

export interface SafeArea { x: number; y: number; width: number; height: number }
export interface PlayerPosition { x: number; y: number; scale: number; rotation?: number; anchor?: Anchor }

export interface CreateCardInput {
  player_image: string;
  output_path: string;
  template: Template | "auto";
  poster_style?: PosterStyle;
  poster_kicker?: string;
  english_tagline?: string;
  poster_reference_path?: string;
  issue_type?: IssueType;
  background_prompt: string;
  team_color: string;
  secondary_color?: string;
  accent_color?: string;
  season?: string;
  league_label?: string;
  team_name?: string;
  player_name?: string;
  jersey_number?: string;
  headline: string;
  score_text: string;
  subheadline: string;
  callout?: string;
  fact_lines?: string[];
  footer: string;
  visual_intensity?: number;
  layout_density?: LayoutDensity;
  player_position?: PlayerPosition;
  text_safe_area: SafeArea;
  seed?: number;
  font_path?: string;
  reuse_background_path?: string;
  reuse_poster_path?: string;
  dry_run?: boolean;
  force?: boolean;
  learning_metadata?: {
    series_id?: string;
    narrative_role?: NarrativeRole;
    hero_type?: HeroType;
    cta_type?: CtaType;
    player_occupancy?: number;
    card_count?: number;
    card_position?: number;
    tags?: string[];
  };
}

interface Manifest {
  version: 1;
  completed: Record<string, boolean>;
  last_failed_step?: string;
}

const templateLighting: Record<Template, { stadium: string; lighting: string; intensity: number }> = {
  cinematic_red: { stadium: "major league night ballpark", lighting: "dramatic red rim and flood lights", intensity: 8 },
  championship_gold: { stadium: "championship final ballpark", lighting: "golden victory spotlights", intensity: 8 },
  night_stadium: { stadium: "packed modern night stadium", lighting: "cool blue high-contrast flood lights", intensity: 6 },
  certificate: { stadium: "elegant dark ceremonial stadium", lighting: "soft formal gold lighting", intensity: 3 },
  breaking_news: { stadium: "broadcast-ready night stadium", lighting: "urgent red and white studio lighting", intensity: 7 },
};

async function loadManifest(filePath: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Manifest;
  } catch {
    return { version: 1, completed: {} };
  }
}

async function saveManifest(filePath: string, manifest: Manifest): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function textBlocks(input: CreateCardInput, config: AppConfig, strategy: AttentionStrategy): TextBlock[] {
  const safe = input.text_safe_area;
  const visibleLength = Array.from(input.headline.replaceAll(/\s/g, "")).length;
  const explicitLines = input.headline.split("\n").length;
  const scoreLength = Array.from(input.score_text.replaceAll(/\s/g, "")).length;
  const scoreParts = input.score_text.trim().match(/^([\d.,]+)\s*([A-Za-z%]+)$/);
  const scoreNumber = scoreParts?.[1] ?? "";
  const scoreSuffix = scoreParts?.[2] ?? "";
  const scoreIsHero = Boolean(input.score_text.trim())
    && scoreLength <= 8
    && ["home_run", "record", "milestone", "championship", "award", "all_star"].includes(strategy.issue_type);
  const headlineSize = scoreIsHero
    ? visibleLength <= 6 ? 130 : visibleLength <= 11 ? 108 : 88
    : visibleLength <= 4 ? 174 : visibleLength <= 8 ? 146 : visibleLength <= 14 ? 112 : 88;
  const estimatedLines = Math.max(explicitLines, Math.ceil(visibleLength / Math.max(4, Math.floor(safe.width / (headlineSize * 0.84)))));
  const kickerWidth = Math.min(safe.width - 100, 720);
  const kickerX = safe.x + (safe.width - kickerWidth) / 2;
  const numericScoreLength = scoreParts ? scoreNumber.length : scoreLength;
  const scoreSize = numericScoreLength <= 2 ? 370 : numericScoreLength <= 4 ? 320 : scoreLength <= 6 ? 270 : 215;
  const heroScoreY = safe.y + 118;
  const headlineY = scoreIsHero ? heroScoreY + scoreSize * 0.95 + 45 : safe.y + 118;
  const headlineHeight = headlineSize * Math.min(3, estimatedLines) * 1.03;
  const scoreY = scoreIsHero ? heroScoreY : Math.min(safe.y + 610, headlineY + headlineHeight + 18);
  const nameplate = [input.player_name, input.jersey_number ? `#${input.jersey_number}` : undefined, input.team_name].filter(Boolean).join(" · ");
  const facts = input.fact_lines?.filter(Boolean).join("  ·  ") ?? "";
  const common = { x: safe.x + 12, width: safe.width - 24, align: "center" as const, color: "#ffffff" };
  const latinScore = /^[\d\s:.,+\-→%A-Za-z]+$/.test(input.score_text);
  const scoreBlocks: TextBlock[] = scoreIsHero && scoreParts
    ? [
      {
        ...common,
        x: safe.x + 30,
        width: safe.width * 0.68,
        text: scoreNumber,
        y: scoreY,
        font_size: scoreSize,
        font_weight: 900,
        style_preset: strategy.headline_preset,
        font_path: config.latinFontPath,
        scale_x: 0.82,
        skew_x: -3,
        letter_spacing: -6,
        line_height: 0.96,
      },
      {
        ...common,
        x: safe.x + safe.width * 0.62,
        width: safe.width * 0.3,
        text: scoreSuffix,
        y: scoreY + scoreSize * 0.42,
        font_size: Math.max(86, Math.round(scoreSize * 0.32)),
        font_weight: 900,
        style_preset: "impact_white",
        font_path: config.latinFontPath,
        scale_x: 0.84,
        skew_x: -3,
        letter_spacing: -2,
      },
    ]
    : [{
      ...common,
      text: input.score_text,
      y: scoreY,
      font_size: scoreIsHero ? scoreSize : 76,
      font_weight: 900,
      style_preset: scoreIsHero ? strategy.headline_preset : "impact_white",
      font_path: latinScore ? config.latinFontPath : config.displayFontPath,
      scale_x: scoreIsHero ? 0.82 : 0.86,
      skew_x: scoreIsHero ? -3 : 0,
      letter_spacing: scoreIsHero ? -6 : -2,
      line_height: 0.96,
    }];
  return [
    {
      ...common,
      x: kickerX,
      width: kickerWidth,
      text: strategy.kicker,
      y: safe.y + 24,
      font_size: 30,
      font_weight: 900,
      color: "#ffffff",
      font_path: config.bodyFontPath,
      scale_x: 0.9,
      letter_spacing: 2,
      plate: { fill: strategy.primary_color, opacity: 0.94, padding_x: 16, padding_y: 8, border_color: strategy.accent_color, border_width: 1, cut_corners: true },
    },
    ...scoreBlocks,
    {
      ...common,
      text: input.headline,
      y: headlineY,
      font_size: headlineSize,
      font_weight: 900,
      style_preset: scoreIsHero ? "impact_white" as const : strategy.headline_preset,
      letter_spacing: -5,
      font_path: config.displayFontPath,
      scale_x: scoreIsHero ? 0.76 : 0.79,
      skew_x: -3,
      line_height: 0.98,
    },
    {
      ...common,
      x: safe.x + 180,
      width: safe.width - 360,
      text: nameplate,
      y: Math.min(790, headlineY + headlineHeight + 30),
      font_size: 38,
      font_weight: 900,
      color: "#ffffff",
      shadow: { color: "#000", opacity: 0.8, blur: 3, offset_x: 2, offset_y: 3 },
      font_path: config.bodyFontPath,
      scale_x: 0.86,
      plate: { fill: strategy.primary_color, opacity: 0.88, padding_x: 12, padding_y: 5, border_color: strategy.accent_color, border_width: 1, cut_corners: true },
    },
    {
      ...common,
      text: input.subheadline,
      y: safe.y + safe.height - 266,
      font_size: 53,
      font_weight: 900,
      style_preset: "impact_white" as const,
      font_path: config.displayFontPath,
      scale_x: 0.8,
      skew_x: -2,
      letter_spacing: -3,
    },
    {
      ...common,
      x: safe.x + 70,
      width: safe.width - 140,
      text: input.callout ?? facts,
      y: safe.y + safe.height - 164,
      font_size: 32,
      font_weight: 800,
      color: strategy.accent_color,
      font_path: config.bodyFontPath,
      scale_x: 0.88,
      plate: { fill: "#020305", opacity: 0.82, padding_x: 12, padding_y: 7, border_color: strategy.accent_color, border_width: 1, cut_corners: true },
    },
    {
      ...common,
      text: input.footer,
      y: safe.y + safe.height - 75,
      font_size: 28,
      font_weight: 800,
      color: "#e7e7e3",
      shadow: { color: "#000", opacity: 0.82, blur: 2, offset_x: 2, offset_y: 2 },
      font_path: config.bodyFontPath,
      scale_x: 0.88,
      letter_spacing: 1,
    },
  ].filter((block) => block.text.length > 0);
}

export class SportsCardPipeline {
  constructor(private readonly dependencies: {
    guard: PathGuard;
    config: AppConfig;
    cache: FileCache;
    backgroundProvider: BackgroundProvider;
    posterProvider?: BackgroundProvider;
    segmentationProvider: SegmentationProvider;
    learningService?: LearningService;
  }) {}

  async create(input: CreateCardInput): Promise<Record<string, unknown>> {
    const source = await this.dependencies.guard.inputImage(input.player_image, ["input"]);
    const output = await this.dependencies.guard.writable(input.output_path, ".png", !input.dry_run);
    const analysis = await analyzeImage(source, this.dependencies.guard, this.dependencies.config);
    const issueType = input.issue_type ?? "generic";
    const requestedPosterStyle = input.poster_style ?? "auto";
    const posterStyle: Exclude<PosterStyle, "auto"> = requestedPosterStyle === "auto"
      ? issueType === "schedule" ? "editorial_local" : "cinematic_poster"
      : requestedPosterStyle;
    const learnedDefaults = this.dependencies.learningService?.appliedDefaults(issueType) ?? { rule_ids: [] };
    const strategy = resolveAttentionStrategy({
      template: input.template === "auto" && learnedDefaults.template ? learnedDefaults.template : input.template,
      issue_type: issueType,
      team_color: input.team_color,
      ...(input.secondary_color ? { secondary_color: input.secondary_color } : {}),
      ...(input.accent_color ? { accent_color: input.accent_color } : {}),
      ...(input.season ? { season: input.season } : {}),
      ...(input.league_label ? { league_label: input.league_label } : {}),
      ...(input.team_name ? { team_name: input.team_name } : {}),
      ...(input.player_name ? { player_name: input.player_name } : {}),
      ...(input.jersey_number ? { jersey_number: input.jersey_number } : {}),
      headline: input.headline,
      score_text: input.score_text,
      ...(input.visual_intensity === undefined ? learnedDefaults.visual_intensity === undefined ? {} : { visual_intensity: learnedDefaults.visual_intensity } : { visual_intensity: input.visual_intensity }),
      ...(input.layout_density ? { layout_density: input.layout_density } : learnedDefaults.layout_density ? { layout_density: learnedDefaults.layout_density } : {}),
    });
    const fontCandidate = input.font_path ?? this.dependencies.config.bodyFontPath ?? this.dependencies.config.displayFontPath ?? this.dependencies.config.fontPath;
    if (!fontCandidate) throw new AppError("FONT_NOT_FOUND", "font_path 또는 SPORTS_CARD_FONT_PATH가 필요합니다. 폰트는 assets 폴더 안에 두세요.");
    const font = await this.dependencies.guard.font(fontCandidate);
    const cinematicReusePath = posterStyle === "cinematic_poster" ? input.reuse_poster_path ?? input.reuse_background_path : undefined;
    if (input.reuse_background_path) await this.dependencies.guard.inputImage(input.reuse_background_path, ["input", "output", "assets"]);
    if (input.reuse_poster_path) await this.dependencies.guard.inputImage(input.reuse_poster_path, ["input", "output", "assets"]);
    const settings = templateLighting[strategy.template];
    // Source photos often leave asymmetric transparent canvas around the player.
    // The attention strategy contains issue-specific optical offsets, so retain
    // them in cinematic poster mode instead of forcing the canvas centre.
    const playerPosition = input.player_position ?? (posterStyle === "cinematic_poster"
      ? { ...strategy.player_position, scale: Math.min(1.5, strategy.player_position.scale * 1.15) }
      : strategy.player_position);
    const backgroundInput: BackgroundInput = {
      theme: `${strategy.template}. ${strategy.background_direction}. ${input.background_prompt}`.trim(),
      stadium_type: settings.stadium,
      lighting: settings.lighting,
      team_color: `${strategy.primary_color} with ${strategy.secondary_color} and ${strategy.accent_color} accents`,
      intensity: strategy.intensity,
      text_safe_area: input.text_safe_area,
      aspect_ratio: "9:16",
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      output_path: "",
      ...(posterStyle === "editorial_local" && input.reuse_background_path ? { reuse_background_path: input.reuse_background_path } : {}),
      ...(input.force === undefined ? {} : { force: input.force }),
    };
    const inferredEnglishTagline = input.english_tagline?.trim()
      || (input.headline.includes("끝내기") && input.headline.includes("만루") ? "WALK-OFF GRAND SLAM" : strategy.issue_label);
    const posterInput: PosterPlateInput = {
      kicker: input.poster_kicker?.trim() || `${input.league_label ?? "KBO"} HIGHLIGHT`,
      headline: input.headline,
      player_name: input.player_name ?? "",
      ...(input.jersey_number ? { jersey_number: input.jersey_number, hero_number: input.jersey_number } : {}),
      subheadline: input.subheadline,
      english_tagline: inferredEnglishTagline,
      team_color: strategy.primary_color,
      accent_color: strategy.accent_color,
      intensity: strategy.intensity,
      narrative_role: input.learning_metadata?.narrative_role ?? "other",
      layout_family: "cinematic_hero",
      subject_slots: 1,
      footer: input.footer,
      context_prompt: input.background_prompt,
      output_path: "",
      ...(input.poster_reference_path ? { reference_path: input.poster_reference_path } : {}),
      ...(cinematicReusePath ? { reuse_poster_path: cinematicReusePath } : {}),
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(input.force === undefined ? {} : { force: input.force }),
    };
    const playerKey = hashObject({ originalHash: analysis.sha256, segmentation: this.dependencies.segmentationProvider.id, algorithm: "original-rgb-alpha-mask-v1" });
    const posterProvider = this.dependencies.posterProvider ?? this.dependencies.backgroundProvider;
    const posterReference = posterStyle === "cinematic_poster"
      ? input.poster_reference_path ?? this.dependencies.config.posterReferencePath
      : undefined;
    const safePosterReference = posterReference
      ? await this.dependencies.guard.inputImage(posterReference, ["assets"])
      : undefined;
    const posterCache = posterStyle === "cinematic_poster"
      ? await posterPlateCacheKey(posterInput, posterProvider, safePosterReference)
      : undefined;
    const backgroundPrompt = posterCache?.prompt ?? makeBackgroundPrompt(backgroundInput);
    const backgroundKey = posterCache?.key ?? hashObject({ provider: this.dependencies.backgroundProvider.id, prompt: backgroundPrompt, seed: input.seed, aspectRatio: "9:16" });
    const playerCacheHit = !input.force && await this.dependencies.cache.has(this.dependencies.cache.playerPath(playerKey));
    const backgroundCacheHit = Boolean(posterStyle === "cinematic_poster" ? cinematicReusePath : input.reuse_background_path) || (!input.force && await this.dependencies.cache.has(this.dependencies.cache.backgroundPath(backgroundKey)));
    const estimatedCalls = (playerCacheHit ? 0 : 1) + (backgroundCacheHit ? 0 : 1);

    if (input.dry_run) {
      return {
        dry_run: true,
        output_path: output,
        steps: posterStyle === "cinematic_poster"
          ? ["analyze_image", "extract_player", "generate_cinematic_poster_plate", "composite_original_player", "technical_visual_qa", "typography_review", "export_reels_card"]
          : ["analyze_image", "extract_player", "generate_sports_background", "composite_player", "add_effect_overlay", "render_card_text", "export_reels_card"],
        estimated_api_calls: estimatedCalls,
        cache: { player: playerCacheHit, background: backgroundCacheHit },
        provider: { background: this.dependencies.backgroundProvider.id, segmentation: this.dependencies.segmentationProvider.id },
        poster: {
          style: posterStyle,
          provider: posterStyle === "cinematic_poster" ? posterProvider.id : undefined,
          reference_path: safePosterReference,
          typography_verification_required: posterStyle === "cinematic_poster",
          composition: posterStyle === "cinematic_poster"
            ? ["giant 3D headline", "skewed nameplate", "ghost jersey number", "centered original player", "double bottom plaque"]
            : ["local SVG typography", "editorial safe zones"],
        },
        design_strategy: strategy,
        learning: { applied_rule_ids: learnedDefaults.rule_ids },
      };
    }

    const { dry_run: _dryRun, ...runInput } = input;
    const runId = hashObject({ source: analysis.sha256, input: runInput }).slice(0, 24);
    const runDir = path.join(this.dependencies.config.workDir, runId);
    await mkdir(runDir, { recursive: true });
    const files = {
      player: path.join(runDir, "01-player.png"),
      background: path.join(runDir, "02-background.png"),
      underlay: path.join(runDir, "02b-attention-underlay.png"),
      composite: path.join(runDir, "03-composite.png"),
      effects: path.join(runDir, "04-effects.png"),
      text: path.join(runDir, "05-text.png"),
    };
    const manifestPath = path.join(runDir, "manifest.json");
    const manifest = await loadManifest(manifestPath);
    const resumed: string[] = [];
    let apiCalls = 0;

    const step = async (name: string, outputPath: string, action: () => Promise<unknown>): Promise<void> => {
      if (!input.force && manifest.completed[name] && await this.dependencies.guard.exists(outputPath)) {
        resumed.push(name);
        return;
      }
      try {
        const result = await action();
        if (result && typeof result === "object" && "api_calls" in result && typeof (result as { api_calls?: unknown }).api_calls === "number") {
          apiCalls += (result as { api_calls: number }).api_calls;
        }
        manifest.completed[name] = true;
        delete manifest.last_failed_step;
        await saveManifest(manifestPath, manifest);
      } catch (error) {
        manifest.last_failed_step = name;
        await saveManifest(manifestPath, manifest);
        if (error instanceof AppError) throw new AppError(error.code, error.message, error.retryable, name);
        throw new AppError("PIPELINE_STEP_FAILED", `${name} 단계가 실패했습니다: ${error instanceof Error ? error.message : "unknown"}`, false, name);
      }
    };

    await step("extract_player", files.player, () => extractPlayer(
      { input_image: source, output_path: files.player, ...(input.force === undefined ? {} : { force: input.force }) },
      { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: this.dependencies.segmentationProvider },
    ));
    await step("generate_sports_background", files.background, () => posterStyle === "cinematic_poster"
      ? generatePosterPlate(
        { ...posterInput, output_path: files.background },
        { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: posterProvider },
      )
      : generateSportsBackground(
        { ...backgroundInput, output_path: files.background },
        { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: this.dependencies.backgroundProvider },
      ));
    await step("composite_player", files.composite, async () => {
      if (posterStyle === "editorial_local") {
        await addAttentionUnderlay({
          input_image: files.background,
          output_path: files.underlay,
          ...(strategy.hero_text ? { hero_text: strategy.hero_text } : {}),
          font_path: this.dependencies.config.latinFontPath ?? font,
          primary_color: strategy.primary_color,
          accent_color: strategy.accent_color,
          intensity: strategy.intensity,
          density: strategy.density,
        }, { guard: this.dependencies.guard });
      }
      return compositePlayer({
        player_png: files.player,
        background_image: posterStyle === "cinematic_poster" ? files.background : files.underlay,
        x: playerPosition.x,
        y: playerPosition.y,
        scale: playerPosition.scale,
        rotation: playerPosition.rotation ?? 0,
        anchor: playerPosition.anchor ?? "center",
        shadow: posterStyle === "cinematic_poster"
          ? { color: "#000000", opacity: 0.86, blur: 16, offset_x: 10, offset_y: 18 }
          : { color: "#000000", opacity: 0.72, blur: 20, offset_x: 16, offset_y: 24 },
        rim_light: posterStyle === "cinematic_poster"
          ? { color: "#17243C", opacity: 0.86, width: 4 }
          : { color: strategy.accent_color, opacity: 0.34, width: 3 },
        output_path: files.composite,
      }, { guard: this.dependencies.guard, config: this.dependencies.config });
    });
    await step("add_effect_overlay", files.effects, () => posterStyle === "cinematic_poster"
      ? sharp(files.composite).png({ compressionLevel: 9 }).toFile(files.effects)
      : addEffectOverlay({
        input_image: files.composite,
        output_path: files.effects,
        theme: strategy.template,
        team_color: strategy.primary_color,
        intensity: strategy.intensity,
        attention_mode: true,
        accent_color: strategy.accent_color,
        density: strategy.density,
        ...(input.seed === undefined ? {} : { seed: input.seed }),
      }, { guard: this.dependencies.guard }));
    await step("render_card_text", files.text, () => posterStyle === "cinematic_poster"
      ? sharp(files.effects).png({ compressionLevel: 9 }).toFile(files.text)
      : renderCardText({
        input_image: files.effects,
        output_path: files.text,
        font_path: font,
        text_blocks: textBlocks(input, this.dependencies.config, strategy),
      }, { guard: this.dependencies.guard }));
    await step("export_reels_card", output, () => exportReelsCard({ input_image: files.text, output_path: output }, { guard: this.dependencies.guard }));
    const visualQa = await inspectCardImage(output, { guard: this.dependencies.guard });

    let learningCardId: string | undefined;
    let learningWarning: string | undefined;
    if (this.dependencies.learningService) {
      try {
        const metadata = input.learning_metadata;
        const learned = await this.dependencies.learningService.registerCard({
          card_id: runId,
          ...(metadata?.series_id ? { series_id: metadata.series_id } : {}),
          output_paths: [output],
          headline: input.headline,
          source: "generated",
          features: LearningService.featuresFromGeneration({
            issue_type: strategy.issue_type,
            template: strategy.template,
            layout_density: strategy.density,
            visual_intensity: strategy.intensity,
            include_player: true,
            headline: input.headline,
            ...(metadata?.narrative_role ? { narrative_role: metadata.narrative_role } : {}),
            ...(metadata?.hero_type ? { hero_type: metadata.hero_type } : strategy.hero_text ? { hero_type: "number" } : { hero_type: "player" }),
            ...(metadata?.cta_type ? { cta_type: metadata.cta_type } : {}),
            ...(metadata?.player_occupancy === undefined ? {} : { player_occupancy: metadata.player_occupancy }),
            ...(metadata?.card_count === undefined ? {} : { card_count: metadata.card_count }),
            ...(metadata?.card_position === undefined ? {} : { card_position: metadata.card_position }),
            primary_color: strategy.primary_color,
            accent_color: strategy.accent_color,
            tags: metadata?.tags ?? [],
          }),
          prompt_summary: backgroundPrompt,
        });
        learningCardId = learned.id;
      } catch (error) {
        learningWarning = error instanceof Error ? error.message : "학습 기록 저장 실패";
        logger.error("card learning registration failed", learningWarning);
      }
    }

    return {
      dry_run: false,
      status: posterStyle === "cinematic_poster" || !visualQa.passed ? "review_required" : "passed",
      output_path: output,
      width: 1080,
      height: 1920,
      format: "png",
      api_calls: apiCalls,
      estimated_api_calls: estimatedCalls,
      resumed_steps: resumed,
      work_id: runId,
      cache: { player: playerCacheHit, background: backgroundCacheHit },
      design_strategy: strategy,
      poster: {
        style: posterStyle,
        provider: posterStyle === "cinematic_poster" ? posterProvider.id : undefined,
        typography_verification_required: posterStyle === "cinematic_poster",
        reference_path: safePosterReference,
      },
      quality_gate: {
        technical: visualQa,
        typography: posterStyle === "cinematic_poster" ? "manual_review_required" : "locally_rendered",
        completion_rule: "기술 검수와 타이포 검수가 모두 통과해야 게시 가능한 완성본입니다.",
      },
      learning: {
        ...(learningCardId ? { card_id: learningCardId } : {}),
        applied_rule_ids: learnedDefaults.rule_ids,
        ...(learningWarning ? { warning: learningWarning } : {}),
      },
    };
  }
}
