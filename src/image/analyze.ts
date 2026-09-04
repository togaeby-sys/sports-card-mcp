import { stat } from "node:fs/promises";
import sharp from "sharp";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";
import { hashFile } from "../utils/hash.js";

export interface ImageAnalysis {
  path: string;
  format: string;
  width: number;
  height: number;
  oriented_width: number;
  oriented_height: number;
  channels: number;
  has_alpha: boolean;
  color_space: string;
  bytes: number;
  sha256: string;
  aspect_ratio: number;
}

export async function analyzeImage(filePath: string, guard: PathGuard, config: AppConfig): Promise<ImageAnalysis> {
  const safePath = await guard.inputImage(filePath);
  try {
    const [metadata, fileInfo, sha256] = await Promise.all([
      sharp(safePath, { limitInputPixels: config.maxImagePixels }).metadata(),
      stat(safePath),
      hashFile(safePath),
    ]);
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new AppError("INVALID_IMAGE", "이미지 메타데이터를 읽을 수 없습니다.");
    }
    const pixels = metadata.width * metadata.height;
    if (pixels > config.maxImagePixels) {
      throw new AppError("IMAGE_TOO_LARGE", `이미지 픽셀 수가 제한 ${config.maxImagePixels}을 초과했습니다.`);
    }
    const swap = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const orientedWidth = swap ? metadata.height : metadata.width;
    const orientedHeight = swap ? metadata.width : metadata.height;
    return {
      path: safePath,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      oriented_width: orientedWidth,
      oriented_height: orientedHeight,
      channels: metadata.channels ?? 0,
      has_alpha: metadata.hasAlpha ?? false,
      color_space: metadata.space ?? "unknown",
      bytes: fileInfo.size,
      sha256,
      aspect_ratio: orientedWidth / orientedHeight,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /pixel limit|exceeds.*pixels|too large/i.test(error.message)) {
      throw new AppError("IMAGE_TOO_LARGE", `이미지 픽셀 수가 제한 ${config.maxImagePixels}을 초과했습니다.`);
    }
    throw new AppError("INVALID_IMAGE", `유효한 이미지로 읽을 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

export async function validateImageDimensions(filePath: string, config: AppConfig): Promise<{ width: number; height: number; format: string }> {
  try {
    const metadata = await sharp(filePath, { limitInputPixels: config.maxImagePixels }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) throw new Error("metadata missing");
    if (metadata.width * metadata.height > config.maxImagePixels) {
      throw new AppError("IMAGE_TOO_LARGE", `이미지 픽셀 수가 제한 ${config.maxImagePixels}을 초과했습니다.`);
    }
    return { width: metadata.width, height: metadata.height, format: metadata.format };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /pixel limit|exceeds.*pixels|too large/i.test(error.message)) {
      throw new AppError("IMAGE_TOO_LARGE", `이미지 픽셀 수가 제한 ${config.maxImagePixels}을 초과했습니다.`);
    }
    throw new AppError("INVALID_IMAGE", "이미지 크기 또는 형식이 올바르지 않습니다.");
  }
}
