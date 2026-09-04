import sharp from "sharp";
import type { PathGuard } from "../security/paths.js";

export async function exportReelsCard(input: { input_image: string; output_path: string }, dependencies: { guard: PathGuard }): Promise<{ output_path: string; width: 1080; height: 1920; format: "png" }> {
  const source = await dependencies.guard.inputImage(input.input_image, ["output"]);
  const output = await dependencies.guard.writable(input.output_path);
  await sharp(source).resize(1080, 1920, { fit: "cover" }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
  return { output_path: output, width: 1080, height: 1920, format: "png" };
}
