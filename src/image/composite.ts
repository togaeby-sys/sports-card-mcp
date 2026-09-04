import sharp, { type OverlayOptions } from "sharp";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { PathGuard } from "../security/paths.js";

export type Anchor = "top_left" | "top_center" | "top_right" | "center_left" | "center" | "center_right" | "bottom_left" | "bottom_center" | "bottom_right";
export type Shadow = boolean | { color?: string; opacity?: number; blur?: number; offset_x?: number; offset_y?: number };
export type RimLight = boolean | { color?: string; opacity?: number; width?: number };

export interface CompositeInput {
  player_png: string;
  background_image: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  anchor: Anchor;
  shadow: Shadow;
  rim_light: RimLight;
  output_path: string;
}

function position(x: number, y: number, width: number, height: number, anchor: Anchor): { left: number; top: number } {
  const horizontal = anchor.endsWith("left") ? 0 : anchor.endsWith("right") ? 1 : 0.5;
  const vertical = anchor.startsWith("top") ? 0 : anchor.startsWith("bottom") ? 1 : 0.5;
  return { left: Math.round(x - width * horizontal), top: Math.round(y - height * vertical) };
}

async function coloredAlphaLayer(source: Buffer, color: string, opacity: number, blur: number): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new AppError("INVALID_IMAGE", "선수 레이어 크기를 읽을 수 없습니다.");
  const alphaIndex = Math.max(0, Math.min(3, (meta.channels ?? 4) - 1)) as 0 | 1 | 2 | 3;
  let alphaPipeline = sharp(source).extractChannel(alphaIndex);
  if (blur > 0.3) alphaPipeline = alphaPipeline.blur(blur);
  const alpha = await alphaPipeline.linear(Math.max(0, Math.min(1, opacity))).raw().toBuffer();
  return sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: color } })
    .joinChannel(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
    .png()
    .toBuffer();
}

async function clipToCanvas(source: Buffer, left: number, top: number): Promise<OverlayOptions | undefined> {
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) return undefined;
  const sourceLeft = Math.max(0, -left);
  const sourceTop = Math.max(0, -top);
  const destinationLeft = Math.max(0, left);
  const destinationTop = Math.max(0, top);
  const width = Math.min(metadata.width - sourceLeft, 1080 - destinationLeft);
  const height = Math.min(metadata.height - sourceTop, 1920 - destinationTop);
  if (width <= 0 || height <= 0) return undefined;
  const clipped = sourceLeft === 0 && sourceTop === 0 && width === metadata.width && height === metadata.height
    ? source
    : await sharp(source).extract({ left: sourceLeft, top: sourceTop, width, height }).png().toBuffer();
  return { input: clipped, left: destinationLeft, top: destinationTop };
}

export async function compositePlayer(input: CompositeInput, dependencies: { guard: PathGuard; config: AppConfig }): Promise<{ output_path: string; width: number; height: number }> {
  const playerPath = await dependencies.guard.inputImage(input.player_png, ["output"]);
  const backgroundPath = await dependencies.guard.inputImage(input.background_image, ["input", "output", "assets"]);
  const output = await dependencies.guard.writable(input.output_path);
  const playerMeta = await sharp(playerPath).metadata();
  if (!playerMeta.width || !playerMeta.height || !playerMeta.hasAlpha) {
    throw new AppError("INVALID_IMAGE", "player_png는 알파 채널이 있는 PNG여야 합니다.");
  }
  const targetWidth = Math.max(1, Math.round(playerMeta.width * input.scale));
  let player = await sharp(playerPath)
    .resize({ width: targetWidth })
    .rotate(input.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const transformed = await sharp(player).metadata();
  if (!transformed.width || !transformed.height) throw new AppError("INVALID_IMAGE", "변환된 선수 이미지가 올바르지 않습니다.");
  const base = position(input.x, input.y, transformed.width, transformed.height, input.anchor);
  const overlays: OverlayOptions[] = [];
  if (input.shadow) {
    const value = typeof input.shadow === "boolean" ? {} : input.shadow;
    const layer = await coloredAlphaLayer(player, value.color ?? "#000000", value.opacity ?? 0.65, value.blur ?? 18);
    const overlay = await clipToCanvas(layer, base.left + (value.offset_x ?? 14), base.top + (value.offset_y ?? 22));
    if (overlay) overlays.push(overlay);
  }
  if (input.rim_light) {
    const value = typeof input.rim_light === "boolean" ? {} : input.rim_light;
    const layer = await coloredAlphaLayer(player, value.color ?? "#ffffff", value.opacity ?? 0.55, value.width ?? 7);
    const overlay = await clipToCanvas(layer, base.left, base.top);
    if (overlay) overlays.push(overlay);
  }
  const playerOverlay = await clipToCanvas(player, base.left, base.top);
  if (!playerOverlay) throw new AppError("INVALID_ARGUMENT", "선수 레이어가 최종 캔버스 밖에 있습니다.");
  overlays.push(playerOverlay);
  await sharp(backgroundPath)
    .resize(1080, 1920, { fit: "cover" })
    .composite(overlays)
    .png({ compressionLevel: 9 })
    .toFile(output);
  return { output_path: output, width: 1080, height: 1920 };
}
