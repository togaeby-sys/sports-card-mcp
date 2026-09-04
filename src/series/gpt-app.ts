import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { FileCache } from "../cache.js";
import type { AppConfig } from "../config.js";
import { AppError, publicError } from "../errors.js";
import { compositePlayer } from "../image/composite.js";
import { extractPlayer } from "../image/extract.js";
import { inspectCardImage, type CardQualityReport } from "../image/quality.js";
import { normalizeSubjectCutout } from "../image/subject.js";
import type { SegmentationProvider } from "../providers/types.js";
import type { PathGuard } from "../security/paths.js";
import { hashFile, hashObject } from "../utils/hash.js";
import {
  directSeries,
  layoutDirection,
  subjectPlacement,
  type CreateSeriesInput,
  type DirectedCard,
  type DirectedSeries,
} from "./director.js";

type JobStatus = "waiting_for_generation" | "partially_imported" | "review_required" | "passed";
type CardStatus = "waiting_for_generation" | "importing" | "review_required" | "passed" | "failed";

interface GptAppCardJob {
  id: string;
  index: number;
  role: string;
  status: CardStatus;
  prompt_path: string;
  request_path: string;
  expected_image_path: string;
  plate_path: string;
  output_path: string;
  style_reference_path?: string;
  attachments_to_upload: string[];
  forbidden_attachments: string[];
  photo_indices: number[];
  card: DirectedCard;
  exact_text_verified: boolean;
  no_generated_people_verified: boolean;
  generated_image_path?: string;
  generated_image_hash?: string;
  api_calls?: number;
  quality?: CardQualityReport;
  review_reasons?: string[];
  last_error?: ReturnType<typeof publicError>;
}

interface GptAppManifest {
  version: 1;
  workflow: "gpt_app_reels";
  job_id: string;
  spec_hash: string;
  series_id: string;
  topic: string;
  output_dir: string;
  job_dir: string;
  manifest_path: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  contract: DirectedSeries["contract"] & {
    render_provider: "gpt_app";
    player_images_sent_to_gpt_app: false;
    implicit_fal_fallback: false;
  };
  source: {
    team_color: string;
    accent_color: string;
    photos: string[];
  };
  cards: GptAppCardJob[];
  review_contact_sheet?: string;
  delivery_manifest?: string;
  last_failed_card?: string;
  last_failed_stage?: string;
}

const manifestSchema = z.object({
  version: z.literal(1),
  workflow: z.literal("gpt_app_reels"),
  job_id: z.string(),
  spec_hash: z.string(),
  series_id: z.string(),
  topic: z.string(),
  output_dir: z.string(),
  job_dir: z.string(),
  manifest_path: z.string(),
  status: z.enum(["waiting_for_generation", "partially_imported", "review_required", "passed"]),
  created_at: z.string(),
  updated_at: z.string(),
  contract: z.record(z.string(), z.unknown()),
  source: z.object({ team_color: z.string(), accent_color: z.string(), photos: z.array(z.string()) }).passthrough(),
  cards: z.array(z.object({
    id: z.string(),
    index: z.number().int(),
    role: z.string(),
    status: z.enum(["waiting_for_generation", "importing", "review_required", "passed", "failed"]),
    prompt_path: z.string(),
    request_path: z.string(),
    expected_image_path: z.string(),
    plate_path: z.string(),
    output_path: z.string(),
    attachments_to_upload: z.array(z.string()),
    forbidden_attachments: z.array(z.string()),
    photo_indices: z.array(z.number().int()),
    card: z.record(z.string(), z.unknown()),
    exact_text_verified: z.boolean(),
    no_generated_people_verified: z.boolean(),
  }).passthrough()),
}).passthrough();

export interface ImportGptAppCardInput {
  job_manifest: string;
  card_id: string;
  generated_image: string;
  exact_text_verified: boolean;
  no_generated_people_verified: boolean;
  force?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function cardCopy(card: DirectedCard): Array<[string, string]> {
  return [
    ["상단 배지", card.kicker],
    ["충격 숫자", card.hero_number],
    ["메인 헤드라인", card.headline],
    ["선수명", card.player_name],
    ["등번호", card.jersey_number],
    ["서브헤드라인", card.subheadline],
    ["영문 태그라인", card.english_tagline],
    ["하단 문구", card.footer],
  ].filter((item): item is [string, string] => Boolean(item[1]?.trim()));
}

function cardPrompt(series: DirectedSeries, input: CreateSeriesInput, card: DirectedCard, requestId: string): string {
  const copy = cardCopy(card);
  const slots = card.photo_indices.map((_photoIndex, subjectIndex) => {
    const placement = subjectPlacement(card, subjectIndex, card.photo_indices.length);
    return `- 선수 슬롯 ${subjectIndex + 1}: 중심 (${placement.x}, ${placement.y}), 목표 높이 약 ${placement.height}px. 이 영역에는 사람·실루엣·글자를 넣지 말고 조명과 프레임만 자연스럽게 이어 주세요.`;
  });
  return [
    `GPT 앱 이미지 생성 작업 ID: ${requestId}`,
    "",
    "세로형 한국 프로야구 릴스 카드의 ‘선수 없는 완성 포스터 판’ 1장을 생성해 주세요.",
    "이 결과 위에 실제 선수 원본 누끼를 로컬에서 합성하므로, 어떤 사람이나 선수도 생성하면 안 됩니다.",
    "",
    "[출력 규격]",
    "- 9:16 세로, 최종 사용 크기 1080×1920",
    "- 한 장의 완성된 블록버스터 영화 포스터처럼 보이게 구성",
    `- 팀 컬러 ${input.team_color}, 강조색 ${input.accent_color ?? "#FF8A00"}`,
    `- 카드 역할: ${card.role}, 구도: ${card.layout_family}`,
    `- 구도 지시: ${layoutDirection(card)}`,
    `- 사건 맥락: ${card.background_prompt}`,
    "",
    "[정확히 표시할 문구]",
    ...copy.map(([label, value]) => `- ${label}: “${value}”`),
    "- 위 문구의 한글·숫자·영문·띄어쓰기를 바꾸거나 번역하지 마세요.",
    "- 위 목록에 없는 설명문, 가짜 기록, 워터마크, 브랜드명은 추가하지 마세요.",
    "",
    "[비주얼 품질]",
    "- 거대한 3D 금속 질감 한글 타이포, 깊은 압출, 검정 외곽선, 금빛/팀 컬러 림라이트",
    "- 기울어진 다중 프레임, 방사형 폭발, 불꽃·스파크·연기·먼지, 야간 경기장 조명",
    "- 전경·중경·후경의 깊이와 강한 명암 대비, 비대칭 원근, 화면을 꽉 채운 밀도",
    "- 파워포인트, 대시보드, 평면 텍스트 상자, 넓고 의미 없는 빈 공간처럼 보이면 안 됩니다.",
    "- 구단 공식 로고나 유니폼 로고를 새로 만들지 마세요.",
    "",
    "[선수 합성 안전영역]",
    ...(slots.length > 0 ? slots : ["- 이 카드는 선수 없는 그래픽 카드입니다. 사람·얼굴·신체·실루엣을 넣지 마세요."]),
    "",
    "[절대 금지]",
    "- 선수, 사람, 얼굴, 손, 신체, 사람 실루엣 생성",
    "- 실제 선수 사진을 재해석하거나 다시 그리기",
    "- 오탈자, 글자 반복, 의미 없는 가짜 한글",
    "- 기존 참고 이미지의 문구나 로고 복사",
    "",
    "첨부된 스타일 참고 이미지는 질감·밀도·타이포 깊이·구도 수준만 참고하세요. 선수 원본 사진은 첨부하지 않습니다.",
    "최종 이미지 1장만 반환해 주세요.",
  ].join("\n");
}

async function writeText(guard: PathGuard, target: string, extension: string, value: string): Promise<string> {
  const output = await guard.writable(target, extension);
  await writeFile(output, value, { encoding: "utf8", mode: 0o600 });
  return output;
}

async function saveManifest(guard: PathGuard, manifest: GptAppManifest): Promise<void> {
  manifest.updated_at = now();
  const passed = manifest.cards.filter((card) => card.status === "passed").length;
  const imported = manifest.cards.filter((card) => card.status === "passed" || card.status === "review_required").length;
  manifest.status = passed === manifest.cards.length
    ? "passed"
    : imported === manifest.cards.length
      ? "review_required"
      : imported > 0
        ? "partially_imported"
        : "waiting_for_generation";
  await writeText(guard, manifest.manifest_path, ".json", `${JSON.stringify(manifest, null, 2)}\n`);
}

async function loadManifest(guard: PathGuard, manifestPath: string): Promise<GptAppManifest> {
  const source = await guard.readable(manifestPath, ["output"]);
  if (path.extname(source).toLowerCase() !== ".json") throw new AppError("INVALID_EXTENSION", "GPT 앱 작업 명세는 .json 파일이어야 합니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(source, "utf8"));
  } catch {
    throw new AppError("INVALID_ARGUMENT", "GPT 앱 작업 명세 JSON을 읽을 수 없습니다. prepare_gpt_app_reels가 반환한 job_manifest를 사용하세요.");
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new AppError("INVALID_ARGUMENT", "GPT 앱 작업 명세 형식이 올바르지 않습니다. 작업을 다시 준비하세요.");
  return parsed as GptAppManifest;
}

async function createContactSheet(paths: string[], outputPath: string, guard: PathGuard): Promise<string> {
  const output = await guard.writable(outputPath);
  const columns = Math.min(4, paths.length);
  const rows = Math.ceil(paths.length / columns);
  const overlays = await Promise.all(paths.map(async (imagePath, index) => ({
    input: await sharp(imagePath).resize(270, 480, { fit: "cover" }).png().toBuffer(),
    left: (index % columns) * 270,
    top: Math.floor(index / columns) * 480,
  })));
  await sharp({ create: { width: columns * 270, height: rows * 480, channels: 3, background: "#090B12" } })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toFile(output);
  return output;
}

export class GptAppReelsWorkflow {
  constructor(private readonly dependencies: {
    guard: PathGuard;
    config: AppConfig;
    cache: FileCache;
    segmentationProvider: SegmentationProvider;
  }) {}

  async prepare(input: CreateSeriesInput): Promise<Record<string, unknown>> {
    const directed = directSeries(input);
    const safePhotos = await Promise.all(input.photos.map((photo) => this.dependencies.guard.inputImage(photo.image_path, ["input"])));
    const photoHashes = await Promise.all(safePhotos.map((photo) => hashFile(photo)));
    await Promise.all(directed.cards.map((card) => this.dependencies.guard.writable(card.output_path, ".png", !input.dry_run)));

    let defaultReference: string | undefined;
    if (this.dependencies.config.posterReferencePath && await this.dependencies.guard.exists(this.dependencies.config.posterReferencePath)) {
      defaultReference = await this.dependencies.guard.inputImage(this.dependencies.config.posterReferencePath, ["assets"]);
    }
    const references = new Map<string, string>();
    for (const card of directed.cards) {
      if (card.poster_reference_path) references.set(card.id, await this.dependencies.guard.inputImage(card.poster_reference_path, ["assets"]));
      else if (defaultReference) references.set(card.id, defaultReference);
    }

    const uniquePhotoIndices = [...new Set(directed.cards.flatMap((card) => card.photo_indices))];
    const segmentationHits = await Promise.all(uniquePhotoIndices.map(async (photoIndex) => {
      if (input.force) return false;
      const key = hashObject({ originalHash: photoHashes[photoIndex], segmentation: this.dependencies.segmentationProvider.id, algorithm: "original-rgb-alpha-mask-v1" });
      return this.dependencies.cache.has(this.dependencies.cache.playerPath(key));
    }));
    const estimatedSegmentationCalls = segmentationHits.filter((hit) => !hit).length;

    if (input.dry_run) {
      return {
        dry_run: true,
        status: "planned",
        render_provider: "gpt_app",
        series_id: directed.series_id,
        estimated_gpt_app_generations: directed.cards.length,
        estimated_api_calls: estimatedSegmentationCalls,
        estimated_calls: { gpt_app_generations: directed.cards.length, fal_segmentation: estimatedSegmentationCalls, fal_poster: 0 },
        implicit_fal_fallback: false,
        player_images_sent_to_gpt_app: false,
        contract: directed.contract,
        cards: directed.cards.map((card) => ({ id: card.id, role: card.role, layout_family: card.layout_family, photo_indices: card.photo_indices, output_path: card.output_path })),
      };
    }

    const stableCards = directed.cards.map(({ typography_verified: _verified, reuse_poster_path: _reuse, ...card }) => card);
    const specHash = hashObject({ series: input.series_id, cards: stableCards, photos: photoHashes, team: input.team_color, accent: input.accent_color }).slice(0, 24);
    const jobId = `${input.series_id}-${specHash.slice(0, 10)}`;
    const jobDir = path.join(directed.output_dir, ".gpt-app", jobId);
    const promptDir = path.join(jobDir, "prompts");
    const requestDir = path.join(jobDir, "requests");
    const inboxDir = path.join(jobDir, "inbox");
    const plateDir = path.join(jobDir, "plates");
    const subjectDir = path.join(jobDir, "subjects");
    const manifestPath = path.join(jobDir, "job.json");
    await this.dependencies.guard.writable(manifestPath, ".json");
    await Promise.all([mkdir(promptDir, { recursive: true }), mkdir(requestDir, { recursive: true }), mkdir(inboxDir, { recursive: true }), mkdir(plateDir, { recursive: true }), mkdir(subjectDir, { recursive: true })]);

    let existing: GptAppManifest | undefined;
    if (await this.dependencies.guard.exists(manifestPath)) existing = await loadManifest(this.dependencies.guard, manifestPath);
    const createdAt = existing?.created_at ?? now();
    const jobs: GptAppCardJob[] = [];
    for (const card of directed.cards) {
      const prefix = `${String(card.index + 1).padStart(2, "0")}-${card.id}`;
      const promptPath = path.join(promptDir, `${prefix}.md`);
      const requestPath = path.join(requestDir, `${prefix}.json`);
      const expectedImagePath = path.join(inboxDir, `${prefix}.png`);
      const platePath = path.join(plateDir, `${prefix}.png`);
      const reference = references.get(card.id);
      const requestId = `${jobId}:${card.id}`;
      const prompt = cardPrompt(directed, input, card, requestId);
      await writeText(this.dependencies.guard, promptPath, ".md", `${prompt}\n`);
      await writeText(this.dependencies.guard, requestPath, ".json", `${JSON.stringify({
        request_id: requestId,
        app: "ChatGPT",
        action: "generate_one_image",
        prompt_path: promptPath,
        prompt,
        attachments_to_upload: reference ? [reference] : [],
        forbidden_attachments: card.photo_indices.map((photoIndex) => safePhotos[photoIndex]),
        exact_copy: cardCopy(card).map(([, value]) => value),
        save_download_as: expectedImagePath,
        output_contract: { aspect_ratio: "9:16", width: 1080, height: 1920, format_after_import: "png" },
      }, null, 2)}\n`);
      const previous = existing?.cards.find((item) => item.id === card.id);
      const shouldRetry = input.force === true || input.retry_cards?.includes(card.id) === true;
      jobs.push({
        id: card.id,
        index: card.index,
        role: card.role,
        status: shouldRetry ? "waiting_for_generation" : previous?.status ?? "waiting_for_generation",
        prompt_path: promptPath,
        request_path: requestPath,
        expected_image_path: expectedImagePath,
        plate_path: platePath,
        output_path: card.output_path,
        ...(reference ? { style_reference_path: reference } : {}),
        attachments_to_upload: reference ? [reference] : [],
        forbidden_attachments: card.photo_indices.map((photoIndex) => safePhotos[photoIndex]!),
        photo_indices: card.photo_indices,
        card,
        exact_text_verified: shouldRetry ? false : previous?.exact_text_verified ?? false,
        no_generated_people_verified: shouldRetry ? false : previous?.no_generated_people_verified ?? false,
        ...(!shouldRetry && previous?.generated_image_path ? { generated_image_path: previous.generated_image_path } : {}),
        ...(!shouldRetry && previous?.generated_image_hash ? { generated_image_hash: previous.generated_image_hash } : {}),
        ...(!shouldRetry && previous?.api_calls !== undefined ? { api_calls: previous.api_calls } : {}),
        ...(!shouldRetry && previous?.quality ? { quality: previous.quality } : {}),
        ...(!shouldRetry && previous?.review_reasons ? { review_reasons: previous.review_reasons } : {}),
      });
    }

    const manifest: GptAppManifest = {
      version: 1,
      workflow: "gpt_app_reels",
      job_id: jobId,
      spec_hash: specHash,
      series_id: directed.series_id,
      topic: input.topic,
      output_dir: directed.output_dir,
      job_dir: jobDir,
      manifest_path: manifestPath,
      status: "waiting_for_generation",
      created_at: createdAt,
      updated_at: now(),
      contract: {
        ...directed.contract,
        render_provider: "gpt_app",
        player_images_sent_to_gpt_app: false,
        implicit_fal_fallback: false,
      },
      source: { team_color: input.team_color, accent_color: input.accent_color ?? "#FF8A00", photos: safePhotos },
      cards: jobs,
    };
    await saveManifest(this.dependencies.guard, manifest);
    const guidePath = await writeText(this.dependencies.guard, path.join(jobDir, "OPERATOR.md"), ".md", [
      `# GPT 앱 릴스 작업: ${input.series_id}`,
      "",
      "1. cards 배열의 순서대로 prompt_path 내용을 ChatGPT 이미지 생성에 입력합니다.",
      "2. attachments_to_upload만 첨부합니다. forbidden_attachments의 선수 사진은 절대 GPT 앱에 올리지 않습니다.",
      "3. 결과를 expected_image_path에 저장합니다.",
      "4. import_gpt_app_card로 한 장씩 가져오고 문구와 사람 미생성 여부를 확인합니다.",
      "5. 모든 카드가 들어오면 finalize_gpt_app_reels를 실행합니다.",
      "",
      "fal.ai 포스터 생성으로 자동 대체되지 않습니다.",
    ].join("\n"));

    return {
      dry_run: false,
      status: manifest.status,
      render_provider: "gpt_app",
      series_id: directed.series_id,
      job_id: jobId,
      job_manifest: manifestPath,
      operator_guide: guidePath,
      estimated_gpt_app_generations: jobs.filter((card) => card.status === "waiting_for_generation" || card.status === "failed").length,
      estimated_api_calls: estimatedSegmentationCalls,
      estimated_calls: { gpt_app_generations: jobs.filter((card) => card.status === "waiting_for_generation" || card.status === "failed").length, fal_segmentation: estimatedSegmentationCalls, fal_poster: 0 },
      player_images_sent_to_gpt_app: false,
      implicit_fal_fallback: false,
      cards: jobs.map((card) => ({
        id: card.id,
        role: card.role,
        status: card.status,
        prompt_path: card.prompt_path,
        request_path: card.request_path,
        attachments_to_upload: card.attachments_to_upload,
        forbidden_attachments: card.forbidden_attachments,
        expected_image_path: card.expected_image_path,
        final_output_path: card.output_path,
      })),
      next_action: "GPT 앱에서 각 request_path 작업을 실행해 expected_image_path로 저장한 뒤 import_gpt_app_card를 호출하세요.",
    };
  }

  async importCard(input: ImportGptAppCardInput): Promise<Record<string, unknown>> {
    const manifest = await loadManifest(this.dependencies.guard, input.job_manifest);
    const cardJob = manifest.cards.find((card) => card.id === input.card_id);
    if (!cardJob) throw new AppError("INVALID_ARGUMENT", `작업 명세에 없는 card_id입니다: ${input.card_id}`);
    if (cardJob.status === "passed" && !input.force) {
      return { status: "passed", resumed: true, card_id: cardJob.id, output_path: cardJob.output_path, job_manifest: manifest.manifest_path, quality: cardJob.quality };
    }
    const generated = await this.dependencies.guard.inputImage(input.generated_image, ["input", "output", "assets"]);
    cardJob.status = "importing";
    delete cardJob.last_error;
    await saveManifest(this.dependencies.guard, manifest);
    try {
      const metadata = await sharp(generated).metadata();
      if (!metadata.width || !metadata.height) throw new AppError("INVALID_IMAGE", "GPT 앱 결과 이미지의 크기를 읽을 수 없습니다.");
      if (metadata.width * metadata.height > this.dependencies.config.maxImagePixels) throw new AppError("IMAGE_TOO_LARGE", "GPT 앱 결과 이미지의 픽셀 수가 허용 범위를 초과했습니다.");
      const ratio = metadata.width / metadata.height;
      if (ratio < 0.45 || ratio > 0.70) throw new AppError("INVALID_IMAGE", "GPT 앱 결과가 세로 9:16과 지나치게 다릅니다. 세로형으로 다시 생성해 주세요.");
      const platePath = await this.dependencies.guard.writable(cardJob.plate_path);
      await sharp(generated).rotate().resize(1080, 1920, { fit: "cover", position: "centre" }).png({ compressionLevel: 9 }).toFile(platePath);

      let basePath = platePath;
      let apiCalls = 0;
      for (let subjectIndex = 0; subjectIndex < cardJob.photo_indices.length; subjectIndex += 1) {
        const photoIndex = cardJob.photo_indices[subjectIndex]!;
        const photo = manifest.source.photos[photoIndex];
        if (!photo) throw new AppError("FILE_NOT_FOUND", `${cardJob.id}: 원본 선수 사진 ${photoIndex}를 작업 명세에서 찾을 수 없습니다.`);
        const safePhoto = await this.dependencies.guard.inputImage(photo, ["input"]);
        const extractedPath = path.join(manifest.job_dir, "subjects", `photo-${photoIndex}-extracted.png`);
        const normalizedPath = path.join(manifest.job_dir, "subjects", `photo-${photoIndex}-normalized.png`);
        const extraction = await extractPlayer(
          { input_image: safePhoto, output_path: extractedPath, ...(input.force ? { force: true } : {}) },
          { guard: this.dependencies.guard, config: this.dependencies.config, cache: this.dependencies.cache, provider: this.dependencies.segmentationProvider },
        );
        apiCalls += extraction.api_calls;
        const normalized = await normalizeSubjectCutout(extractedPath, normalizedPath, { guard: this.dependencies.guard });
        const subjectMetadata = await sharp(normalized.output_path).metadata();
        if (!subjectMetadata.height) throw new AppError("INVALID_IMAGE", `${cardJob.id}: 선수 누끼 높이를 읽을 수 없습니다.`);
        const placement = subjectPlacement(cardJob.card, subjectIndex, cardJob.photo_indices.length);
        const compositePath = subjectIndex === cardJob.photo_indices.length - 1
          ? cardJob.output_path
          : path.join(manifest.job_dir, "plates", `${String(cardJob.index + 1).padStart(2, "0")}-${cardJob.id}-composite-${subjectIndex}.png`);
        await compositePlayer({
          player_png: normalized.output_path,
          background_image: basePath,
          x: placement.x,
          y: placement.y,
          scale: placement.height / subjectMetadata.height,
          rotation: cardJob.photo_indices.length === 2 ? subjectIndex === 0 ? -2 : 2 : 0,
          anchor: "center",
          shadow: { color: "#000000", opacity: 0.84, blur: 18, offset_x: 10, offset_y: 20 },
          rim_light: { color: manifest.source.accent_color, opacity: 0.72, width: 5 },
          output_path: compositePath,
        }, { guard: this.dependencies.guard, config: this.dependencies.config });
        basePath = compositePath;
      }
      if (cardJob.photo_indices.length === 0) {
        await sharp(platePath).png({ compressionLevel: 9 }).toFile(await this.dependencies.guard.writable(cardJob.output_path));
      }

      const quality = await inspectCardImage(cardJob.output_path, { guard: this.dependencies.guard });
      const reviewReasons = [...quality.warnings];
      if (!input.exact_text_verified) reviewReasons.push("GPT 앱이 만든 한글·숫자·영문 문구가 작업 명세와 정확히 일치하는지 육안 확인이 필요합니다.");
      if (!input.no_generated_people_verified) reviewReasons.push("GPT 앱 포스터 판에 사람·선수·신체·실루엣이 생성되지 않았는지 육안 확인이 필요합니다.");
      cardJob.exact_text_verified = input.exact_text_verified;
      cardJob.no_generated_people_verified = input.no_generated_people_verified;
      cardJob.generated_image_path = generated;
      cardJob.generated_image_hash = await hashFile(generated);
      cardJob.api_calls = apiCalls;
      cardJob.quality = quality;
      cardJob.review_reasons = reviewReasons;
      cardJob.status = quality.passed && input.exact_text_verified && input.no_generated_people_verified ? "passed" : "review_required";
      delete manifest.last_failed_card;
      delete manifest.last_failed_stage;
      await saveManifest(this.dependencies.guard, manifest);
      return {
        status: cardJob.status,
        card_id: cardJob.id,
        output_path: cardJob.output_path,
        normalized_plate_path: cardJob.plate_path,
        job_manifest: manifest.manifest_path,
        api_calls: apiCalls,
        original_player_composited: cardJob.photo_indices.length > 0,
        player_images_sent_to_gpt_app: false,
        exact_text_verified: cardJob.exact_text_verified,
        no_generated_people_verified: cardJob.no_generated_people_verified,
        quality,
        review_reasons: reviewReasons,
        next_action: cardJob.status === "passed" ? "다음 카드를 가져오거나 finalize_gpt_app_reels를 실행하세요." : "검수 실패 항목을 수정한 뒤 이 카드만 force=true로 다시 가져오세요.",
      };
    } catch (error) {
      cardJob.status = "failed";
      cardJob.last_error = publicError(error);
      manifest.last_failed_card = cardJob.id;
      manifest.last_failed_stage = "normalize_composite_or_quality_gate";
      await saveManifest(this.dependencies.guard, manifest);
      throw error;
    }
  }

  async status(jobManifest: string): Promise<Record<string, unknown>> {
    const manifest = await loadManifest(this.dependencies.guard, jobManifest);
    return {
      status: manifest.status,
      series_id: manifest.series_id,
      job_id: manifest.job_id,
      job_manifest: manifest.manifest_path,
      cards: manifest.cards.map((card) => ({
        id: card.id,
        role: card.role,
        status: card.status,
        prompt_path: card.prompt_path,
        request_path: card.request_path,
        expected_image_path: card.expected_image_path,
        output_path: card.output_path,
        review_reasons: card.review_reasons ?? [],
      })),
      pending_cards: manifest.cards.filter((card) => card.status === "waiting_for_generation" || card.status === "failed").map((card) => card.id),
      review_required_cards: manifest.cards.filter((card) => card.status === "review_required").map((card) => card.id),
      passed_cards: manifest.cards.filter((card) => card.status === "passed").map((card) => card.id),
    };
  }

  async finalize(jobManifest: string): Promise<Record<string, unknown>> {
    const manifest = await loadManifest(this.dependencies.guard, jobManifest);
    const missing = manifest.cards.filter((card) => !card.quality).map((card) => card.id);
    if (missing.length > 0) {
      return {
        status: "waiting_for_generation",
        job_manifest: manifest.manifest_path,
        pending_cards: missing,
        next_action: "pending_cards의 GPT 앱 결과를 import_gpt_app_card로 먼저 가져오세요.",
      };
    }
    const sheet = await createContactSheet(
      manifest.cards.map((card) => card.output_path),
      path.join(manifest.output_dir, `00-${manifest.series_id}-review-contact-sheet.png`),
      this.dependencies.guard,
    );
    manifest.review_contact_sheet = sheet;
    const reviewCards = manifest.cards.filter((card) => card.status !== "passed").map((card) => card.id);
    const deliveryPath = path.join(manifest.output_dir, `${manifest.series_id}-delivery.json`);
    manifest.delivery_manifest = deliveryPath;
    await saveManifest(this.dependencies.guard, manifest);
    await writeText(this.dependencies.guard, deliveryPath, ".json", `${JSON.stringify({
      version: 1,
      workflow: "gpt_app_reels",
      series_id: manifest.series_id,
      status: reviewCards.length === 0 ? "passed" : "review_required",
      created_at: now(),
      cards: manifest.cards.map((card) => ({ id: card.id, role: card.role, output_path: card.output_path, status: card.status, quality: card.quality })),
      review_contact_sheet: sheet,
      original_player_pixels: true,
      player_images_sent_to_gpt_app: false,
    }, null, 2)}\n`);
    return {
      status: reviewCards.length === 0 ? "passed" : "review_required",
      series_id: manifest.series_id,
      job_manifest: manifest.manifest_path,
      delivery_manifest: deliveryPath,
      review_contact_sheet: sheet,
      completed_cards: manifest.cards.length,
      review_required_cards: reviewCards,
      cards: manifest.cards.map((card) => ({ id: card.id, role: card.role, output_path: card.output_path, status: card.status })),
      next_action: reviewCards.length === 0 ? "Project003에서 카드 결합·음악·게시 단계를 진행할 수 있습니다." : "review_required_cards만 다시 생성하고 가져오세요.",
    };
  }
}
