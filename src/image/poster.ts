import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { FileCache } from "../cache.js";
import type { BackgroundProvider } from "../providers/types.js";
import type { PathGuard } from "../security/paths.js";
import { hashFile, hashObject } from "../utils/hash.js";

export interface PosterPlateInput {
  kicker: string;
  headline: string;
  player_name: string;
  jersey_number?: string;
  hero_number?: string;
  subheadline: string;
  english_tagline: string;
  team_color: string;
  accent_color: string;
  intensity: number;
  narrative_role?: string;
  layout_family?: string;
  layout_direction?: string;
  subject_slots?: number;
  footer?: string;
  context_prompt?: string;
  output_path: string;
  reference_path?: string;
  reuse_poster_path?: string;
  seed?: number;
  force?: boolean;
}

export interface PosterPlateResult {
  output_path: string;
  cache_hit: boolean;
  reused: boolean;
  cache_key: string;
  api_calls: number;
  prompt: string;
  typography_verification_required: boolean;
}

function exact(label: string, value: string): string {
  return `${label}: "${value.replaceAll('"', "")}"`;
}

export function makePosterPlatePrompt(input: PosterPlateInput): string {
  const hero = input.hero_number?.trim() || input.jersey_number?.trim() || "";
  const nameplate = [input.player_name.trim(), input.jersey_number?.trim() ? `#${input.jersey_number.trim()}` : ""].filter(Boolean).join(" · ");
  const subjectSlots = input.subject_slots ?? 1;
  const subjectDirection = subjectSlots === 0
    ? "Do not reserve an empty athlete hole. Fill the composition with a baseball, mound, stadium tunnel, scoreboard-like geometry or abstract light appropriate to the story, but never generate any person."
    : subjectSlots === 1
      ? "Keep one connected center-lower original-athlete slot completely empty and unobstructed from approximately y=690 to y=1590. The slot must be large enough for a cutout occupying 48 to 62 percent of the canvas height."
      : "Keep two overlapping original-athlete slots empty in the lower half, one left and one right, with clear separation and dramatic opposing rim lights.";
  return [
    "Transform the reference into a finished 1080x1920 vertical Korean professional baseball blockbuster movie-poster typography plate.",
    `Narrative role: ${input.narrative_role ?? "hero"}. Layout family: ${input.layout_family ?? "cinematic_hero"}.`,
    input.layout_direction ?? "Use an enormous stacked Korean 3D headline, deep black extrusion, hammered metallic face, hot edge light, skewed frames, lens-star highlights, dense sparks, radial speed lines, stadium floodlights, fire and smoke.",
    subjectDirection,
    "Do not draw a player, person, body, face, silhouette, uniform, bat or team logo anywhere in the image.",
    hero ? `Use a huge translucent outlined ${hero} numeral as a background depth layer, never as a flat dashboard number.` : "Use one strong baseball-story symbol as a background depth layer.",
    "Place the Korean secondary copy in a wide slanted black plaque near y=1580 and the English tagline in a separate narrower plaque below it. Maintain dramatic depth, overlaps and asymmetric perspective; never use flat rounded rectangles, dashboard cards or presentation-slide styling.",
    "The entire card must feel visually occupied and intentional. Avoid dead empty zones, generic gradients, centered PowerPoint alignment and repeated identical panel sizes.",
    "All visible wording must use the exact supplied spelling. Do not translate, paraphrase, invent, duplicate or add words.",
    exact("small top plaque", input.kicker),
    exact("giant main Korean headline", input.headline),
    exact("black nameplate", nameplate),
    exact("bottom Korean plaque", input.subheadline),
    exact("bottom English plaque", input.english_tagline),
    ...(input.footer?.trim() ? [exact("small footer", input.footer)] : []),
    ...(input.context_prompt?.trim() ? [`Story context for visual direction only, never print this sentence: ${input.context_prompt}`] : []),
    `Palette: deep black and ${input.team_color}, metallic accent ${input.accent_color}. Visual intensity ${input.intensity}/10.`,
    "No watermark, no sponsor, no signature, no extra logo, no mockup border.",
  ].join(" ");
}

export async function posterPlateCacheKey(
  input: PosterPlateInput,
  provider: BackgroundProvider,
  referencePath?: string,
): Promise<{ key: string; prompt: string; reference_hash?: string }> {
  const prompt = makePosterPlatePrompt(input);
  const referenceHash = referencePath ? await hashFile(referencePath) : undefined;
  return {
    key: hashObject({ mode: "cinematic-poster-v2-role-directed", provider: provider.id, prompt, seed: input.seed, referenceHash }),
    prompt,
    ...(referenceHash ? { reference_hash: referenceHash } : {}),
  };
}

export async function generatePosterPlate(
  input: PosterPlateInput,
  dependencies: { guard: PathGuard; config: AppConfig; cache: FileCache; provider: BackgroundProvider },
): Promise<PosterPlateResult> {
  const output = await dependencies.guard.writable(input.output_path);
  if (input.reuse_poster_path) {
    const reused = await dependencies.guard.inputImage(input.reuse_poster_path, ["input", "output", "assets"]);
    const { key, prompt } = await posterPlateCacheKey(input, dependencies.provider);
    await sharp(reused).resize(1080, 1920, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(output);
    return { output_path: output, cache_hit: false, reused: true, cache_key: key, api_calls: 0, prompt, typography_verification_required: false };
  }

  const configuredReference = input.reference_path ?? dependencies.config.posterReferencePath;
  const referencePath = configuredReference
    ? await dependencies.guard.inputImage(configuredReference, ["assets"])
    : undefined;
  const { key, prompt } = await posterPlateCacheKey(input, dependencies.provider, referencePath);
  const cached = dependencies.cache.backgroundPath(key);
  if (!input.force && await dependencies.cache.has(cached)) {
    await dependencies.cache.restore(cached, output);
    return { output_path: output, cache_hit: true, reused: false, cache_key: key, api_calls: 0, prompt, typography_verification_required: true };
  }

  const referenceImage = referencePath ? await readFile(referencePath) : undefined;
  const generated = await dependencies.provider.generate({
    prompt,
    aspectRatio: "9:16",
    outputFormat: "png",
    ...(input.seed === undefined ? {} : { seed: input.seed }),
    ...(referenceImage ? { referenceImage, referenceMimeType: "image/png" } : {}),
  });
  await sharp(generated, { limitInputPixels: dependencies.config.maxImagePixels })
    .resize(1080, 1920, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(output);
  await dependencies.cache.put(output, cached);
  return { output_path: output, cache_hit: false, reused: false, cache_key: key, api_calls: 1, prompt, typography_verification_required: true };
}
