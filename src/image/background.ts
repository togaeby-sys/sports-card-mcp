import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { FileCache } from "../cache.js";
import type { BackgroundProvider } from "../providers/types.js";
import type { PathGuard } from "../security/paths.js";
import { hashObject } from "../utils/hash.js";

export interface BackgroundInput {
  theme: string;
  stadium_type: string;
  lighting: string;
  team_color: string;
  intensity: number;
  text_safe_area: { x: number; y: number; width: number; height: number };
  aspect_ratio: string;
  seed?: number;
  output_path: string;
  reuse_background_path?: string;
  force?: boolean;
}

export interface BackgroundResult {
  output_path: string;
  cache_hit: boolean;
  reused: boolean;
  cache_key: string;
  api_calls: number;
  prompt: string;
}

export function makeBackgroundPrompt(input: BackgroundInput): string {
  const safe = input.text_safe_area;
  return [
    `Vertical cinematic professional baseball stadium background, ${input.theme} theme.`,
    `${input.stadium_type} stadium, ${input.lighting} lighting, dominant accent color ${input.team_color}.`,
    `Atmospheric stadium lights, controlled flames, sparks, particles and smoke, visual intensity ${input.intensity}/10.`,
    `Keep a low-detail text-safe area at x ${safe.x}, y ${safe.y}, width ${safe.width}, height ${safe.height} on a 1080x1920 canvas.`,
    "Background plate only. No people, no player, no athlete, no human silhouette, no text, no letters, no numbers, no logos, no trademarks, no watermark.",
  ].join(" ");
}

export async function generateSportsBackground(
  input: BackgroundInput,
  dependencies: { guard: PathGuard; config: AppConfig; cache: FileCache; provider: BackgroundProvider },
): Promise<BackgroundResult> {
  const output = await dependencies.guard.writable(input.output_path);
  const prompt = makeBackgroundPrompt(input);
  const key = hashObject({ provider: dependencies.provider.id, prompt, seed: input.seed, aspectRatio: input.aspect_ratio });
  const cached = dependencies.cache.backgroundPath(key);

  if (input.reuse_background_path) {
    const reused = await dependencies.guard.inputImage(input.reuse_background_path, ["input", "output", "assets"]);
    await sharp(reused).resize(1080, 1920, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(output);
    return { output_path: output, cache_hit: false, reused: true, cache_key: key, api_calls: 0, prompt };
  }
  if (!input.force && await dependencies.cache.has(cached)) {
    await dependencies.cache.restore(cached, output);
    return { output_path: output, cache_hit: true, reused: false, cache_key: key, api_calls: 0, prompt };
  }
  const generated = await dependencies.provider.generate({
    prompt,
    aspectRatio: input.aspect_ratio,
    outputFormat: "png",
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  });
  await sharp(generated, { limitInputPixels: dependencies.config.maxImagePixels })
    .resize(1080, 1920, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(output);
  await dependencies.cache.put(output, cached);
  return { output_path: output, cache_hit: false, reused: false, cache_key: key, api_calls: 1, prompt };
}
