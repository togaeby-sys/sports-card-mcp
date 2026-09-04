import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  font_size: number;
  font_weight: number;
  align: "left" | "center" | "right";
  color?: string;
  line_height?: number;
  stroke?: string | { color: string; width: number };
  shadow?: boolean | { color?: string; opacity?: number; blur?: number; offset_x?: number; offset_y?: number };
  style_preset?: "clean" | "impact_white" | "impact_gold" | "impact_orange";
  font_style?: "normal" | "italic";
  letter_spacing?: number;
  font_path?: string;
  scale_x?: number;
  skew_x?: number;
  opacity?: number;
  plate?: {
    fill: string;
    opacity?: number;
    border_color?: string;
    border_width?: number;
    padding_x?: number;
    padding_y?: number;
    radius?: number;
    cut_corners?: boolean;
  };
}

export interface RenderTextInput {
  input_image: string;
  output_path: string;
  font_path: string;
  text_blocks: TextBlock[];
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function wrapText(text: string, width: number, fontSize: number, scaleX = 1): string[] {
  const maxUnits = Math.max(1, width / (fontSize * scaleX));
  const lines: string[] = [];
  let line = "";
  let units = 0;
  for (const character of Array.from(text)) {
    if (character === "\n") {
      lines.push(line);
      line = "";
      units = 0;
      continue;
    }
    const next = /[\x00-\xff]/.test(character) ? 0.58 : 1;
    if (line && units + next > maxUnits) {
      lines.push(line.trimEnd());
      line = character.trimStart();
      units = next;
    } else {
      line += character;
      units += next;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

function fontMime(fontPath: string): string {
  const extension = path.extname(fontPath).toLowerCase();
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".woff") return "font/woff";
  if (extension === ".otf") return "font/otf";
  return "font/ttf";
}

export async function buildTextSvg(width: number, height: number, fontPath: string, blocks: TextBlock[]): Promise<Buffer> {
  const fontPaths = [...new Set([fontPath, ...blocks.flatMap((block) => block.font_path ? [block.font_path] : [])])];
  const fonts = new Map<string, { family: string; data: Buffer }>();
  for (const [index, currentPath] of fontPaths.entries()) {
    try {
      fonts.set(currentPath, { family: `CardFont${index}`, data: await readFile(currentPath) });
    } catch {
      throw new AppError("FONT_NOT_FOUND", `폰트 파일을 읽을 수 없습니다: ${currentPath}`);
    }
  }
  const items = blocks.map((block, index) => {
    const scaleX = block.scale_x ?? 1;
    const skewX = block.skew_x ?? 0;
    const lines = wrapText(block.text, block.width, block.font_size, scaleX);
    const anchor = block.align === "center" ? "middle" : block.align === "right" ? "end" : "start";
    const x = block.align === "center" ? block.x + block.width / 2 : block.align === "right" ? block.x + block.width : block.x;
    const stroke = typeof block.stroke === "string" ? { color: block.stroke, width: 2 } : block.stroke;
    const shadow = block.shadow ? (typeof block.shadow === "boolean" ? {} : block.shadow) : undefined;
    const filterId = `shadow-${index}`;
    const preset = block.style_preset ?? "clean";
    const impact = preset !== "clean";
    const gradientId = `text-gradient-${index}`;
    const gradient = preset === "impact_gold"
      ? `<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe49a"/><stop offset=".42" stop-color="#f6b91e"/><stop offset="1" stop-color="#bd7108"/></linearGradient>`
      : preset === "impact_orange"
        ? `<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc65a"/><stop offset=".48" stop-color="#ff760d"/><stop offset="1" stop-color="#d83c00"/></linearGradient>`
        : preset === "impact_white"
          ? `<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".62" stop-color="#f4f4f2"/><stop offset="1" stop-color="#c7cbd0"/></linearGradient>`
          : "";
    const filter = shadow || impact ? `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadow ? shadow.offset_x ?? 3 : 3}" dy="${shadow ? shadow.offset_y ?? 5 : 5}" stdDeviation="${shadow ? shadow.blur ?? 3 : 2.2}" flood-color="${escapeXml(shadow ? shadow.color ?? "#000" : "#000")}" flood-opacity="${shadow ? shadow.opacity ?? 0.82 : 0.86}"/>${impact ? `<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="${preset === "impact_white" ? "#ffffff" : "#ffb21c"}" flood-opacity=".18"/>` : ""}</filter>` : "";
    const lineHeight = block.line_height ?? 1.12;
    const makeTspans = (offsetX = 0) => lines.map((line, lineIndex) => `<tspan x="${x + offsetX}" dy="${lineIndex === 0 ? 0 : block.font_size * lineHeight}">${escapeXml(line)}</tspan>`).join("");
    const tspans = makeTspans();
    const baseline = block.y + block.font_size;
    const family = fonts.get(block.font_path ?? fontPath)?.family ?? "CardFont0";
    const typography = `text-anchor="${anchor}" font-family="${family}" font-size="${block.font_size}" font-weight="${block.font_weight}" font-style="${block.font_style ?? "normal"}" letter-spacing="${block.letter_spacing ?? (impact ? -3 : 0)}"`;
    const tangent = Math.tan(skewX * Math.PI / 180);
    const transformX = x - scaleX * x - tangent * baseline;
    const transform = scaleX !== 1 || skewX !== 0 ? ` transform="matrix(${scaleX} 0 ${tangent.toFixed(5)} 1 ${transformX.toFixed(3)} 0)"` : "";
    const mainFill = impact ? `url(#${gradientId})` : escapeXml(block.color ?? "#fff");
    const impactStroke = preset === "impact_white" ? "#151515" : "#281000";
    const effectiveStroke = stroke ?? (impact ? { color: impactStroke, width: preset === "impact_white" ? 5 : 4 } : undefined);
    const extrusion = impact ? `<text x="${x + 2}" y="${baseline + 5}" ${typography}${transform} fill="${preset === "impact_white" ? "#33363a" : "#6d3104"}" stroke="#050505" stroke-width="6" paint-order="stroke">${makeTspans(2)}</text>` : "";
    const plate = block.plate;
    const platePaddingX = plate?.padding_x ?? 0;
    const platePaddingY = plate?.padding_y ?? 0;
    const plateX = block.x - platePaddingX;
    const plateY = block.y - platePaddingY;
    const plateWidth = block.width + platePaddingX * 2;
    const plateHeight = block.font_size * lineHeight * lines.length + platePaddingY * 2;
    const cut = Math.min(14, plateHeight * 0.22);
    const plateShape = plate?.cut_corners
      ? `<path d="M${plateX + cut} ${plateY} H${plateX + plateWidth - cut} L${plateX + plateWidth} ${plateY + cut} V${plateY + plateHeight - cut} L${plateX + plateWidth - cut} ${plateY + plateHeight} H${plateX + cut} L${plateX} ${plateY + plateHeight - cut} V${plateY + cut} Z" fill="${escapeXml(plate.fill)}" fill-opacity="${plate.opacity ?? 1}"${plate.border_color ? ` stroke="${escapeXml(plate.border_color)}" stroke-width="${plate.border_width ?? 1}"` : ""}/>`
      : plate ? `<rect x="${plateX}" y="${plateY}" width="${plateWidth}" height="${plateHeight}" rx="${plate.radius ?? 0}" fill="${escapeXml(plate.fill)}" fill-opacity="${plate.opacity ?? 1}"${plate.border_color ? ` stroke="${escapeXml(plate.border_color)}" stroke-width="${plate.border_width ?? 1}"` : ""}/>` : "";
    return `${gradient}${filter}<g opacity="${block.opacity ?? 1}">${plateShape}${extrusion}<text x="${x}" y="${baseline}" ${typography}${transform} fill="${mainFill}"${effectiveStroke ? ` stroke="${escapeXml(effectiveStroke.color)}" stroke-width="${effectiveStroke.width}" paint-order="stroke"` : ""}${shadow || impact ? ` filter="url(#${filterId})"` : ""}>${tspans}</text>${impact ? `<text x="${x}" y="${baseline - 1}" ${typography}${transform} fill="none" stroke="${preset === "impact_white" ? "#ffffff" : "#ffd76a"}" stroke-width="1" opacity=".62">${tspans}</text>` : ""}</g>`;
  }).join("");
  const fontCss = [...fonts.entries()].map(([currentPath, font]) => `@font-face{font-family:${font.family};src:url(data:${fontMime(currentPath)};base64,${font.data.toString("base64")})}`).join("");
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>${fontCss}</style>${items}</svg>`);
}

export async function renderCardText(input: RenderTextInput, dependencies: { guard: PathGuard }): Promise<{ output_path: string; text_blocks: number }> {
  const source = await dependencies.guard.inputImage(input.input_image, ["output"]);
  const output = await dependencies.guard.writable(input.output_path);
  const font = await dependencies.guard.font(input.font_path);
  const safeBlocks = await Promise.all(input.text_blocks.map(async (block) => block.font_path
    ? { ...block, font_path: await dependencies.guard.font(block.font_path) }
    : block));
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new AppError("INVALID_IMAGE", "입력 이미지 크기를 읽을 수 없습니다.");
  const svg = await buildTextSvg(metadata.width, metadata.height, font, safeBlocks);
  await sharp(source).composite([{ input: svg }]).png({ compressionLevel: 9 }).toFile(output);
  return { output_path: output, text_blocks: input.text_blocks.length };
}
