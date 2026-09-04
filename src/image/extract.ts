import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { FileCache } from "../cache.js";
import { AppError } from "../errors.js";
import type { SegmentationProvider } from "../providers/types.js";
import type { PathGuard } from "../security/paths.js";
import { hashFile, hashObject } from "../utils/hash.js";
import { validateImageDimensions } from "./analyze.js";

export interface ExtractResult {
  output_path: string;
  cache_hit: boolean;
  cache_key: string;
  api_calls: number;
  width: number;
  height: number;
}

function mimeFor(extension: string): string {
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

export async function extractPlayer(
  input: { input_image: string; output_path: string; force?: boolean },
  dependencies: { guard: PathGuard; config: AppConfig; cache: FileCache; provider: SegmentationProvider },
): Promise<ExtractResult> {
  const source = await dependencies.guard.inputImage(input.input_image);
  const output = await dependencies.guard.writable(input.output_path);
  const originalHash = await hashFile(source);
  const key = hashObject({ originalHash, segmentation: dependencies.provider.id, algorithm: "original-rgb-alpha-mask-v1" });
  const cached = dependencies.cache.playerPath(key);
  if (!input.force && await dependencies.cache.has(cached)) {
    await dependencies.cache.restore(cached, output);
    const metadata = await validateImageDimensions(output, dependencies.config);
    return { output_path: output, cache_hit: true, cache_key: key, api_calls: 0, width: metadata.width, height: metadata.height };
  }

  const original = await readFile(source);
  const originalMetadata = await sharp(original, { limitInputPixels: dependencies.config.maxImagePixels }).rotate().metadata();
  if (!originalMetadata.width || !originalMetadata.height) throw new AppError("INVALID_IMAGE", "원본 이미지 크기를 읽을 수 없습니다.");
  const width = originalMetadata.width;
  const height = originalMetadata.height;
  const maskBuffer = await dependencies.provider.createMask(original, mimeFor(source.slice(source.lastIndexOf(".")).toLowerCase()));
  const maskMetadata = await sharp(maskBuffer, { limitInputPixels: dependencies.config.maxImagePixels }).metadata();
  const maskChannel = (maskMetadata.hasAlpha ? Math.max(0, (maskMetadata.channels ?? 4) - 1) : 0) as 0 | 1 | 2 | 3;
  const alpha = await sharp(maskBuffer)
    .resize(width, height, { fit: "fill" })
    .extractChannel(maskChannel)
    .raw()
    .toBuffer();
  const rgb = await sharp(original)
    .rotate()
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(output);
  await dependencies.cache.put(output, cached);
  return { output_path: output, cache_hit: false, cache_key: key, api_calls: 1, width, height };
}
