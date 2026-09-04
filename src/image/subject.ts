import sharp from "sharp";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";

export interface SubjectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  source_width: number;
  source_height: number;
  alpha_coverage: number;
}

export async function subjectBounds(inputPath: string): Promise<SubjectBounds> {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !metadata.hasAlpha) {
    throw new AppError("INVALID_IMAGE", "선수 누끼는 알파 채널이 있는 PNG여야 합니다.");
  }
  const alpha = await image.extractChannel(3).raw().toBuffer();
  let minX = metadata.width;
  let minY = metadata.height;
  let maxX = -1;
  let maxY = -1;
  let visible = 0;
  for (let y = 0; y < metadata.height; y += 1) {
    for (let x = 0; x < metadata.width; x += 1) {
      if ((alpha[y * metadata.width + x] ?? 0) < 8) continue;
      visible += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) throw new AppError("INVALID_IMAGE", "선수 누끼에 보이는 인물 픽셀이 없습니다.");
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    source_width: metadata.width,
    source_height: metadata.height,
    alpha_coverage: visible / (metadata.width * metadata.height),
  };
}

export async function normalizeSubjectCutout(
  inputPath: string,
  outputPath: string,
  dependencies: { guard: PathGuard },
): Promise<{ output_path: string; bounds: SubjectBounds }> {
  const source = await dependencies.guard.inputImage(inputPath, ["output"]);
  const output = await dependencies.guard.writable(outputPath);
  const bounds = await subjectBounds(source);
  await sharp(source)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })
    .png({ compressionLevel: 9 })
    .toFile(output);
  return { output_path: output, bounds };
}
