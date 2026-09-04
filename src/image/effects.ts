import sharp from "sharp";
import type { PathGuard } from "../security/paths.js";

export interface EffectInput {
  input_image: string;
  output_path: string;
  theme?: "cinematic_red" | "championship_gold" | "night_stadium" | "certificate" | "breaking_news";
  team_color?: string;
  intensity?: number;
  seed?: number;
  attention_mode?: boolean;
  accent_color?: string;
  density?: "balanced" | "dense" | "maximum";
}

function random(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function effectSvg(input: EffectInput): Buffer {
  const rand = random(input.seed ?? 1);
  const count = Math.round(10 + (input.intensity ?? 5) * 2.2);
  const color = input.team_color ?? "#e31b23";
  const accent = input.accent_color ?? "#ff9a00";
  const density = input.density ?? "dense";
  const particles = Array.from({ length: count }, () => {
    const side = rand() > 0.5;
    const x = side ? 820 + rand() * 250 : 10 + rand() * 250;
    const y = 120 + rand() * 1680;
    const radius = 1 + rand() * 3;
    const opacity = 0.12 + rand() * 0.42;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${rand() > .7 ? accent : "#fff"}" opacity="${opacity.toFixed(2)}"/>`;
  }).join("");
  const speedLines = input.attention_mode ? Array.from({ length: density === "maximum" ? 7 : 4 }, (_, index) => {
    const y = 760 + index * 135;
    const left = index % 2 === 0;
    return `<path d="M${left ? 0 : 1080} ${y} L${left ? 210 : 870} ${y - 28}" stroke="${index % 3 === 0 ? accent : color}" stroke-width="${index % 3 === 0 ? 4 : 2}" opacity=".24"/>`;
  }).join("") : "";
  const attentionFrames = input.attention_mode ? `
    <rect x="0" y="0" width="1080" height="690" fill="url(#topScrim)"/>
    <rect x="0" y="1510" width="1080" height="410" fill="url(#bottomScrim)"/>
    <path d="M78 92 L1002 92" stroke="${accent}" stroke-width="2" opacity=".62"/>
    <path d="M78 1818 L1002 1818" stroke="${color}" stroke-width="4" opacity=".68"/>
    <path d="M18 1035 L152 1009 L127 1034 L232 1034 L204 1057 L91 1057 L116 1040 Z" fill="${accent}" opacity=".34"/>
    <path d="M1062 1035 L928 1009 L953 1034 L848 1034 L876 1057 L989 1057 L964 1040 Z" fill="${accent}" opacity=".34"/>
    ${speedLines}` : "";
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g"><stop stop-color="${color}" stop-opacity=".32"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>
      <radialGradient id="v"><stop offset=".48" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>
      <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#020305" stop-opacity=".88"/><stop offset=".68" stop-color="#020305" stop-opacity=".36"/><stop offset="1" stop-color="#020305" stop-opacity="0"/></linearGradient>
      <linearGradient id="bottomScrim" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#020305" stop-opacity=".9"/><stop offset="1" stop-color="#020305" stop-opacity="0"/></linearGradient>
    </defs>
    <ellipse cx="60" cy="1080" rx="250" ry="620" fill="url(#g)"/><ellipse cx="1020" cy="980" rx="240" ry="580" fill="url(#g)"/>
    ${particles}
    ${attentionFrames}
    <path d="M0 1760 L1080 1580 L1080 1920 L0 1920Z" fill="#000" opacity=".16"/>
    <rect width="1080" height="1920" fill="url(#v)"/>
  </svg>`);
}

export async function addEffectOverlay(input: EffectInput, dependencies: { guard: PathGuard }): Promise<{ output_path: string }> {
  const source = await dependencies.guard.inputImage(input.input_image, ["output"]);
  const output = await dependencies.guard.writable(input.output_path);
  await sharp(source).resize(1080, 1920, { fit: "cover" }).composite([{ input: effectSvg(input) }]).png({ compressionLevel: 9 }).toFile(output);
  return { output_path: output };
}
