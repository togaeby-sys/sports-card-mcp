import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FileCache } from "../cache.js";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { compositePlayer } from "../image/composite.js";
import { extractPlayer } from "../image/extract.js";
import { generatePosterPlate, posterPlateCacheKey, type PosterPlateInput } from "../image/poster.js";
import { inspectCardImage, type CardQualityReport } from "../image/quality.js";
import { normalizeSubjectCutout } from "../image/subject.js";
import type { SubjectBounds } from "../image/subject.js";
import type { BackgroundProvider, SegmentationProvider } from "../providers/types.js";
import type { PathGuard } from "../security/paths.js";
import { hashFile, hashObject } from "../utils/hash.js";
import { directSeries, layoutDirection, subjectPlacement, type CreateSeriesInput } from "./director.js";

interface SeriesManifest {
  version: 1;
  completed_cards: Record<string, boolean>;
  last_failed_card?: string;
  last_failed_stage?: string;
}

interface CardRunResult {
  id: string;
  role: string;
  layout_family: string;
  output_path: string;
  poster_plate_path: string;
  player_photo_indices: number[];
  player_occupancy: number[];
  api_calls: number;
  resumed: boolean;
  typography_verification_required: boolean;
  typography_verified: boolean;
  status: "passed" | "review_required";
  quality: CardQualityReport;
  review_reasons: string[];
}

async function loadManifest(filePath: string): Promise<SeriesManifest> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as SeriesManifest;
  } catch {
    return { version: 1, completed_cards: {} };
  }
}

async function saveManifest(filePath: string, manifest: SeriesManifest): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function createReviewContactSheet(paths: string[], outputPath: string, guard: PathGuard): Promise<string> {
  const output = await guard.writable(outputPath);
  const columns = Math.min(4, paths.length);
  const rows = Math.ceil(paths.length / columns);
  const cellWidth = 270;
  const cellHeight = 480;
  const overlays = await Promise.all(paths.map(async (imagePath, index) => ({
    input: await sharp(imagePath).resize(cellWidth, cellHeight, { fit: "cover" }).png().toBuffer(),
    left: (index % columns) * cellWidth,
    top: Math.floor(index / columns) * cellHeight,
  })));
  await sharp({ create: { width: columns * cellWidth, height: rows * cellHeight, channels: 3, background: "#090B12" } })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toFile(output);
  return output;
}

export class ReelsSeriesPipeline {
  constructor(private readonly dependencies: {
    guard: PathGuard;
    config: AppConfig;
    cache: FileCache;
    posterProvider: BackgroundProvider;
    segmentationProvider: SegmentationProvider;
  }) {}

  async create(input: CreateSeriesInput): Promise<Record<string, unknown>> {
    const directed = directSeries(input);
    const safePhotos = await Promise.all(input.photos.map((photo) => this.dependencies.guard.inputImage(photo.image_path, ["input"])));
    const photoHashes = await Promise.all(safePhotos.map((photo) => hashFile(photo)));
    await Promise.all(directed.cards.map((card) => this.dependencies.guard.writable(card.output_path, ".png", !input.dry_run)));
    const safeReferences = new Map<string, string>();
    for (const card of directed.cards) {
      if (card.typography_verified && !card.reuse_poster_path) {
        throw new AppError("INVALID_ARGUMENT", `${card.id}: 새로 생성할 AI 포스터는 사전에 typography_verified=true로 지정할 수 없습니다. 검수한 poster_plate_path를 reuse_poster_path로 전달하세요.`);
      }
      if (card.poster_reference_path) safeReferences.set(card.id, await this.dependencies.guard.inputImage(card.poster_reference_path, ["assets"]));
      if (card.reuse_poster_path) await this.dependencies.guard.inputImage(card.reuse_poster_path, ["input", "output", "assets"]);
    }

    const posterInputs = directed.cards.map((card): PosterPlateInput => ({
      kicker: card.kicker,
      headline: card.headline,
      player_name: card.player_name ?? "",
      ...(card.jersey_number ? { jersey_number: card.jersey_number } : {}),
      ...(card.hero_number ? { hero_number: card.hero_number } : card.jersey_number ? { hero_number: card.jersey_number } : {}),
      subheadline: card.subheadline,
      english_tagline: card.english_tagline,
      team_color: input.team_color,
      accent_color: input.accent_color ?? "#FF8A00",
      intensity: card.role === "cta" ? 7 : card.role === "hook" || card.role === "climax" ? 10 : 9,
      narrative_role: card.role,
      layout_family: card.layout_family,
      layout_direction: layoutDirection(card),
      subject_slots: card.photo_indices.length,
      footer: card.footer,
      context_prompt: [input.issue_type ?? "generic", input.template ?? "auto", input.season, input.team_name, card.background_prompt].filter(Boolean).join(". "),
      output_path: "",
      ...(safeReferences.get(card.id) ? { reference_path: safeReferences.get(card.id) } : {}),
      ...(card.reuse_poster_path ? { reuse_poster_path: card.reuse_poster_path } : {}),
      ...(card.seed === undefined ? {} : { seed: card.seed }),
    }));

    const uniquePhotoIndices = [...new Set(directed.cards.flatMap((card) => card.photo_indices))];
    const posterCacheHits = await Promise.all(posterInputs.map(async (poster) => {
      if (poster.reuse_poster_path) return true;
      if (input.force) return false;
      const cache = await posterPlateCacheKey(poster, this.dependencies.posterProvider, poster.reference_path);
      return this.dependencies.cache.has(this.dependencies.cache.backgroundPath(cache.key));
    }));
    const playerCacheHits = await Promise.all(uniquePhotoIndices.map(async (photoIndex) => {
      if (input.force) return false;
      const key = hashObject({ originalHash: photoHashes[photoIndex], segmentation: this.dependencies.segmentationProvider.id, algorithm: "original-rgb-alpha-mask-v1" });
      return this.dependencies.cache.has(this.dependencies.cache.playerPath(key));
    }));
    const estimatedPosterCalls = posterInputs.filter((_poster, index) => !posterCacheHits[index]).length;
    const estimatedSegmentationCalls = playerCacheHits.filter((hit) => !hit).length;
    if (input.dry_run) {
      return {
        dry_run: true,
        status: "planned",
        series_id: directed.series_id,
        output_dir: directed.output_dir,
        estimated_api_calls: estimatedPosterCalls + estimatedSegmentationCalls,
        estimated_calls: { poster: estimatedPosterCalls, segmentation: estimatedSegmentationCalls },
        cache: { poster_hits: posterCacheHits.filter(Boolean).length, player_hits: playerCacheHits.filter(Boolean).length },
        contract: directed.contract,
        cards: directed.cards.map((card, index) => ({
          id: card.id,
          index: card.index,
          role: card.role,
          layout_family: card.layout_family,
          output_path: card.output_path,
          include_player: card.include_player,
          photo_indices: card.photo_indices,
          visual_contract: card.visual_contract,
          steps: ["direct_card", "generate_cinematic_poster_plate", ...(card.photo_indices.length ? ["extract_original_player", "normalize_alpha_bounds", "composite_original_player"] : []), "technical_visual_qa", "typography_review", "export_png"],
        })),
      };
    }

    const stableCards = directed.cards.map(({ typography_verified: _verified, reuse_poster_path: _reuse, ...card }) => card);
    const runId = hashObject({ series: input.series_id, cards: stableCards, photos: photoHashes }).slice(0, 24);
    const workDir = path.join(this.dependencies.config.workDir, `series-${runId}`);
    await mkdir(workDir, { recursive: true });
    const manifestPath = path.join(workDir, "manifest.json");
    const manifest = await loadManifest(manifestPath);
    const extracted = new Map<number, { path: string; bounds: SubjectBounds }>();
    let totalApiCalls = 0;

    const preparePhoto = async (photoIndex: number): Promise<{ path: string; bounds: SubjectBounds }> => {
      const existing = extracted.get(photoIndex);
      if (existing) return existing;
      const extractedPath = path.join(workDir, `photo-${photoIndex}-extracted.png`);
      const normalizedPath = path.join(workDir, `photo-${photoIndex}-normalized.png`);
      const extraction = await extractPlayer(
        { input_image: safePhotos[photoIndex]!, output_path: extractedPath, ...(input.force ? { force: true } : {}) },
        { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: this.dependencies.segmentationProvider },
      );
      totalApiCalls += extraction.api_calls;
      const normalized = await normalizeSubjectCutout(extractedPath, normalizedPath, { guard: this.dependencies.guard });
      const prepared = { path: normalizedPath, bounds: normalized.bounds };
      extracted.set(photoIndex, prepared);
      return prepared;
    };

    const results: CardRunResult[] = [];
    for (let index = 0; index < directed.cards.length; index += 1) {
      const card = directed.cards[index]!;
      const posterInput = posterInputs[index]!;
      const forceCard = input.force === true || input.retry_cards?.includes(card.id) === true;
      const cardDir = path.join(workDir, card.id);
      await mkdir(cardDir, { recursive: true });
      const platePath = path.join(cardDir, "01-poster-plate.png");
      const canResume = !forceCard && manifest.completed_cards[card.id] === true && await this.dependencies.guard.exists(card.output_path) && await this.dependencies.guard.exists(platePath);
      try {
        let cardApiCalls = 0;
        const playerOccupancy: number[] = [];
        if (!canResume) {
          const plate = await generatePosterPlate(
            { ...posterInput, output_path: platePath, ...(forceCard && !posterInput.reuse_poster_path ? { force: true } : {}) },
            { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: this.dependencies.posterProvider },
          );
          cardApiCalls += plate.api_calls;
          totalApiCalls += plate.api_calls;
          let basePath = platePath;
          for (let subjectIndex = 0; subjectIndex < card.photo_indices.length; subjectIndex += 1) {
            const photoIndex = card.photo_indices[subjectIndex]!;
            const prepared = await preparePhoto(photoIndex);
            const metadata = await sharp(prepared.path).metadata();
            if (!metadata.height) throw new AppError("INVALID_IMAGE", `${card.id}: 정규화된 선수 높이를 읽을 수 없습니다.`);
            const placement = subjectPlacement(card, subjectIndex, card.photo_indices.length);
            playerOccupancy.push(Number((placement.height / 1920).toFixed(3)));
            const compositePath = subjectIndex === card.photo_indices.length - 1 ? card.output_path : path.join(cardDir, `02-composite-${subjectIndex}.png`);
            await compositePlayer({
              player_png: prepared.path,
              background_image: basePath,
              x: placement.x,
              y: placement.y,
              scale: placement.height / metadata.height,
              rotation: card.photo_indices.length === 2 ? subjectIndex === 0 ? -2 : 2 : 0,
              anchor: "center",
              shadow: { color: "#000000", opacity: 0.84, blur: 18, offset_x: 10, offset_y: 20 },
              rim_light: { color: input.accent_color ?? "#FF8A00", opacity: 0.72, width: 5 },
              output_path: compositePath,
            }, { guard: this.dependencies.guard, config: this.dependencies.config });
            basePath = compositePath;
          }
          if (card.photo_indices.length === 0) {
            await sharp(platePath).resize(1080, 1920, { fit: "fill" }).png({ compressionLevel: 9 }).toFile(card.output_path);
          }
          manifest.completed_cards[card.id] = true;
          delete manifest.last_failed_card;
          delete manifest.last_failed_stage;
          await saveManifest(manifestPath, manifest);
        }

        const quality = await inspectCardImage(card.output_path, { guard: this.dependencies.guard });
        const reviewReasons = [...quality.warnings];
        if (!card.typography_verified) reviewReasons.push("AI가 생성한 한글·숫자·영문 카피의 철자와 중복 여부를 육안으로 확인해야 합니다.");
        const status = quality.passed && card.typography_verified ? "passed" : "review_required";
        results.push({
          id: card.id,
          role: card.role,
          layout_family: card.layout_family,
          output_path: card.output_path,
          poster_plate_path: platePath,
          player_photo_indices: card.photo_indices,
          player_occupancy: playerOccupancy.length > 0 ? playerOccupancy : card.photo_indices.map(() => card.role === "climax" ? 0.667 : card.role === "context" || card.role === "evidence" ? 0.583 : 0.62),
          api_calls: cardApiCalls,
          resumed: canResume,
          typography_verification_required: !card.typography_verified,
          typography_verified: card.typography_verified,
          status,
          quality,
          review_reasons: reviewReasons,
        });
      } catch (error) {
        manifest.last_failed_card = card.id;
        manifest.last_failed_stage = "card_render_or_quality_gate";
        await saveManifest(manifestPath, manifest);
        if (error instanceof AppError) throw new AppError(error.code, error.message, error.retryable, `${card.id}:${manifest.last_failed_stage}`);
        throw new AppError("PIPELINE_STEP_FAILED", `${card.id} 카드 생성 실패: ${error instanceof Error ? error.message : "unknown"}`, false, `${card.id}:${manifest.last_failed_stage}`);
      }
    }

    const reviewCount = results.filter((result) => result.status === "review_required").length;
    const contactSheetPath = await createReviewContactSheet(
      results.map((result) => result.output_path),
      path.join(input.output_dir, `00-${input.series_id}-review-contact-sheet.png`),
      this.dependencies.guard,
    );
    return {
      dry_run: false,
      status: reviewCount > 0 ? "review_required" : "passed",
      series_id: directed.series_id,
      output_dir: directed.output_dir,
      api_calls: totalApiCalls,
      completed_cards: results.length,
      review_required_cards: reviewCount,
      review_contact_sheet: contactSheetPath,
      failed_stage: manifest.last_failed_stage,
      contract: directed.contract,
      cards: results,
      retry_instruction: reviewCount > 0
        ? "오탈자나 구도 문제가 있는 카드 id만 retry_cards에 넣어 재실행하십시오. 검수 통과한 poster_plate_path를 reuse_poster_path로 지정하고 typography_verified=true로 재호출하면 다른 카드는 재생성하지 않습니다."
        : undefined,
    };
  }
}
