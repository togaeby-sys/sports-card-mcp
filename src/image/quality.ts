import sharp from "sharp";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";

export interface CardQualityReport {
  passed: boolean;
  width: number;
  height: number;
  format: string;
  luminance_mean: number;
  luminance_deviation: number;
  checks: {
    exact_canvas: boolean;
    png: boolean;
    visible_content: boolean;
    tonal_range: boolean;
  };
  warnings: string[];
}

export async function inspectCardImage(imagePath: string, dependencies: { guard: PathGuard }): Promise<CardQualityReport> {
  const source = await dependencies.guard.inputImage(imagePath, ["output"]);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new AppError("INVALID_IMAGE", "완성 카드의 크기를 읽을 수 없습니다.");
  const { data, info } = await sharp(source)
    .flatten({ background: "#000000" })
    .resize(54, 96, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const values: number[] = [];
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    values.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  const deviation = Math.sqrt(variance);
  const checks = {
    exact_canvas: metadata.width === 1080 && metadata.height === 1920,
    png: metadata.format === "png",
    visible_content: mean >= 8,
    tonal_range: deviation >= 12,
  };
  const warnings: string[] = [];
  if (!checks.exact_canvas) warnings.push("최종 캔버스가 1080×1920이 아닙니다.");
  if (!checks.png) warnings.push("최종 파일이 PNG가 아닙니다.");
  if (!checks.visible_content) warnings.push("카드가 지나치게 어두워 주요 요소가 보이지 않을 가능성이 큽니다.");
  if (!checks.tonal_range) warnings.push("명암 대비가 낮아 영화 포스터형 시선 집중이 약할 수 있습니다.");
  return {
    passed: Object.values(checks).every(Boolean),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format ?? "unknown",
    luminance_mean: Number(mean.toFixed(2)),
    luminance_deviation: Number(deviation.toFixed(2)),
    checks,
    warnings,
  };
}
