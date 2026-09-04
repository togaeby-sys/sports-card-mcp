import sharp, { type OverlayOptions } from "sharp";
import type { PathGuard } from "../security/paths.js";
import { buildTextSvg } from "./text.js";

export interface AttentionUnderlayInput {
  input_image: string;
  output_path: string;
  hero_text?: string;
  font_path: string;
  primary_color: string;
  accent_color: string;
  intensity: number;
  density: "balanced" | "dense" | "maximum";
}

function burstSvg(input: AttentionUnderlayInput): Buffer {
  const opacity = (0.1 + input.intensity * 0.008).toFixed(2);
  const rayCount = input.density === "maximum" ? 14 : input.density === "dense" ? 10 : 7;
  const rayOpacity = input.density === "maximum" ? 0.17 : input.density === "dense" ? 0.12 : 0.08;
  const rays = Array.from({ length: rayCount }, (_, index) => {
    const angle = -78 + (156 / Math.max(1, rayCount - 1)) * index;
    return `<path d="M620 1110 L600 -100 L640 -100 Z" fill="${index % 4 === 0 ? input.accent_color : input.primary_color}" opacity="${rayOpacity}" transform="rotate(${angle} 620 1110)"/>`;
  }).join("");
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="burst"><stop stop-color="${input.accent_color}" stop-opacity="${opacity}"/><stop offset=".42" stop-color="${input.primary_color}" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <g>${rays}</g>
    <ellipse cx="620" cy="1110" rx="410" ry="560" fill="url(#burst)" filter="url(#blur)"/>
    <path d="M25 1090 L180 1062 L148 1090 L270 1090 L235 1117 L105 1117 L132 1097 Z" fill="${input.accent_color}" opacity=".18"/>
    <path d="M1055 1090 L900 1062 L932 1090 L810 1090 L845 1117 L975 1117 L948 1097 Z" fill="${input.accent_color}" opacity=".18"/>
  </svg>`);
}

export async function addAttentionUnderlay(input: AttentionUnderlayInput, dependencies: { guard: PathGuard }): Promise<{ output_path: string }> {
  const source = await dependencies.guard.inputImage(input.input_image, ["output"]);
  const output = await dependencies.guard.writable(input.output_path);
  const font = await dependencies.guard.font(input.font_path);
  const overlays: OverlayOptions[] = [{ input: burstSvg(input) }];
  if (input.hero_text?.trim()) {
    const compactLength = Array.from(input.hero_text.replaceAll(/\s/g, "")).length;
    const fontSize = compactLength <= 2 ? 650 : compactLength <= 5 ? 410 : 260;
    overlays.push({
      input: await buildTextSvg(1080, 1920, font, [{
        text: input.hero_text,
        x: 25,
        y: compactLength <= 2 ? 650 : 760,
        width: 1030,
        font_size: fontSize,
        font_weight: 900,
        align: "center",
        color: input.accent_color,
        stroke: { color: "#FFF2B0", width: 3 },
        shadow: { color: input.primary_color, opacity: 0.9, blur: 24, offset_x: 0, offset_y: 0 },
        font_path: font,
        scale_x: compactLength <= 2 ? 0.92 : 0.82,
        skew_x: -5,
        letter_spacing: -8,
        opacity: input.density === "maximum" ? 0.09 : 0.06,
      }]),
    });
  }
  await sharp(source).resize(1080, 1920, { fit: "cover" }).composite(overlays).png({ compressionLevel: 9 }).toFile(output);
  return { output_path: output };
}
