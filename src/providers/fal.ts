import { fal } from "@fal-ai/client";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { withRetry } from "../utils/retry.js";
import type { BackgroundProvider, BackgroundRequest, SegmentationProvider } from "./types.js";

interface FalLike {
  subscribe(model: string, options: Record<string, unknown>): Promise<{ data: unknown }>;
  storage: { upload(blob: Blob): Promise<string> };
}

function requireKey(): void {
  if (!process.env.FAL_KEY) {
    throw new AppError("FAL_KEY_MISSING", "FAL_KEY 환경변수가 설정되지 않았습니다.");
  }
}

function findImageUrl(data: unknown): string {
  if (!data || typeof data !== "object") throw new AppError("DOWNLOAD_FAILED", "fal.ai 응답에 이미지가 없습니다.");
  const record = data as Record<string, unknown>;
  const images = record.images;
  if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
    const url = (images[0] as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  for (const key of ["image", "mask", "output"]) {
    const item = record[key];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
      return (item as Record<string, unknown>).url as string;
    }
    if (typeof item === "string" && /^https:\/\//.test(item)) return item;
  }
  throw new AppError("DOWNLOAD_FAILED", "fal.ai 응답에서 이미지 URL을 찾을 수 없습니다.");
}

async function download(url: string, config: AppConfig, signal: AbortSignal): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted) throw new AppError("API_TIMEOUT", "fal.ai 이미지 다운로드 시간이 초과되었습니다.", true);
    throw new AppError("DOWNLOAD_FAILED", `fal.ai 결과를 다운로드하지 못했습니다: ${error instanceof Error ? error.message : "unknown"}`, true);
  }
  if (!response.ok) throw new AppError("DOWNLOAD_FAILED", `fal.ai 결과 다운로드가 HTTP ${response.status}로 실패했습니다.`, response.status >= 500 || response.status === 429);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > config.maxDownloadBytes) throw new AppError("IMAGE_TOO_LARGE", "다운로드 이미지가 허용 크기를 초과했습니다.");
  const result = Buffer.from(await response.arrayBuffer());
  if (result.length > config.maxDownloadBytes) throw new AppError("IMAGE_TOO_LARGE", "다운로드 이미지가 허용 크기를 초과했습니다.");
  return result;
}

abstract class FalBase {
  protected constructor(protected readonly config: AppConfig, protected readonly client: FalLike = fal as unknown as FalLike) {}

  protected async invoke(model: string, input: Record<string, unknown>): Promise<Buffer> {
    requireKey();
    return withRetry(async (signal) => {
      const result = await this.client.subscribe(model, {
        input,
        abortSignal: signal,
      });
      return download(findImageUrl(result.data), this.config, signal);
    }, { timeoutMs: this.config.apiTimeoutMs, retries: this.config.apiRetries, label: model });
  }
}

export class FalBackgroundProvider extends FalBase implements BackgroundProvider {
  readonly id: string;

  constructor(config: AppConfig, client?: FalLike) {
    super(config, client);
    this.id = `fal:${config.backgroundModel}`;
  }

  generate(request: BackgroundRequest): Promise<Buffer> {
    return this.invoke(this.config.backgroundModel, {
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio,
      output_format: request.outputFormat,
      num_images: 1,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
  }
}

export class FalPosterProvider extends FalBase implements BackgroundProvider {
  readonly id: string;

  constructor(config: AppConfig, client?: FalLike) {
    super(config, client);
    this.id = `fal:${config.posterModel}:poster`;
  }

  async generate(request: BackgroundRequest): Promise<Buffer> {
    const imageUrl = request.referenceImage
      ? await withRetry(
        () => this.client.storage.upload(new Blob([new Uint8Array(request.referenceImage!)], { type: request.referenceMimeType ?? "image/png" })),
        { timeoutMs: this.config.apiTimeoutMs, retries: this.config.apiRetries, label: "fal.ai poster reference upload" },
      )
      : undefined;
    return this.invoke(this.config.posterModel, {
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio,
      output_format: request.outputFormat,
      num_images: 1,
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
  }
}

export class FalSegmentationProvider extends FalBase implements SegmentationProvider {
  readonly id: string;

  constructor(config: AppConfig, client?: FalLike) {
    super(config, client);
    this.id = `fal:${config.segmentationModel}`;
  }

  async createMask(image: Buffer, mimeType: string): Promise<Buffer> {
    requireKey();
    const bytes = new Uint8Array(image);
    const uploaded = await withRetry(
      () => this.client.storage.upload(new Blob([bytes], { type: mimeType })),
      { timeoutMs: this.config.apiTimeoutMs, retries: this.config.apiRetries, label: "fal.ai upload" },
    );
    return this.invoke(this.config.segmentationModel, { image_url: uploaded, mask_only: true, output_format: "png" });
  }
}
