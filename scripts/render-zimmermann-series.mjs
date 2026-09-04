import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outDir = path.join(root, "output", "zimmermann-12ip-25runs-series");
const inputDir = path.join(root, "input");
await mkdir(outDir, { recursive: true });
function s2HeroBackdropSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs>
      <radialGradient id="hero-bg" cx="50%" cy="43%" r="58%"><stop offset="0" stop-color="#120605" stop-opacity=".98"/><stop offset=".68" stop-color="#080505" stop-opacity=".94"/><stop offset="1" stop-color="#250804" stop-opacity=".2"/></radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>
    <ellipse cx="540" cy="1260" rx="388" ry="565" fill="url(#hero-bg)" filter="url(#soft)"/>
  </svg>`);
}

async function plate(number) {
  return sharp(path.join(outDir, `s${number}-plate.png`)).resize(1080, 1920, { fit: "fill" }).png().toBuffer();
}

async function normalizedCutout(sourcePath, cutoutPath, crop) {
  const original = sharp(sourcePath).rotate();
  const meta = await original.metadata();
  const alpha = await sharp(cutoutPath)
    .extractChannel("alpha")
    .normalise()
    .resize(meta.width, meta.height, { fit: "fill" })
    .raw()
    .toBuffer();
  const rgb = await sharp(sourcePath).rotate().removeAlpha().toColourspace("srgb").raw().toBuffer();
  const rgba = await sharp(rgb, { raw: { width: meta.width, height: meta.height, channels: 3 } })
    .joinChannel(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
    .png()
    .toBuffer();
  const cropped = crop ? await sharp(rgba).extract(crop).png().toBuffer() : rgba;
  return sharp(cropped)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function fadeBottom(input, start = 0.72) {
  const meta = await sharp(input).metadata();
  const gradient = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="${start}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#fade)"/>
  </svg>`);
  return sharp(input).composite([{ input: gradient, blend: "dest-in" }]).png().toBuffer();
}

async function heroLayer(cutout, maxWidth, maxHeight) {
  const hero = await sharp(cutout).resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(hero).metadata();
  const glow = await sharp(hero).tint("#f37321").blur(17).modulate({ brightness: 1.45, saturation: 1.5 }).png().toBuffer();
  const shadow = await sharp(hero).tint("#000000").blur(12).png().toBuffer();
  return { hero, glow, shadow, width: meta.width, height: meta.height };
}

async function composeHero(base, originalPlate, cutout, options) {
  const layer = await heroLayer(cutout, options.maxWidth, options.maxHeight);
  const left = Math.round(options.centerX - layer.width / 2);
  const top = options.top;
  const bottomStrip = await sharp(originalPlate).extract({ left: 0, top: options.footerTop, width: 1080, height: 1920 - options.footerTop }).png().toBuffer();
  return sharp(base)
    .composite([
      { input: layer.shadow, left: left + 12, top: top + 18 },
      { input: layer.glow, left, top, blend: "screen" },
      { input: layer.hero, left, top },
      { input: bottomStrip, left: 0, top: options.footerTop },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const p1 = await sharp(path.join(outDir, "s1-plate-corrected.png")).resize(1080, 1920, { fit: "fill" }).png().toBuffer();
await sharp(p1).png({ compressionLevel: 9 }).toFile(path.join(outDir, "s1-hook.png"));

const p2 = await sharp(path.join(outDir, "s2-plate-corrected-ai.png")).resize(1080, 1920, { fit: "fill" }).png().toBuffer();
const p2Corrected = await sharp(p2).composite([
  { input: s2HeroBackdropSvg(), left: 0, top: 0 },
]).png().toBuffer();
const cutout1 = await normalizedCutout(
  path.join(inputDir, "짐머맨1.jpg"),
  path.join(outDir, "zimmermann1-cutout.png"),
);
const s2 = await composeHero(p2Corrected, p2, cutout1, { centerX: 550, top: 670, maxWidth: 1020, maxHeight: 1210, footerTop: 1670 });
await sharp(s2).flatten({ background: "#000000" }).png({ compressionLevel: 9 }).toFile(path.join(outDir, "s2-context.png"));

const p3 = await plate(3);
await sharp(p3).png({ compressionLevel: 9 }).toFile(path.join(outDir, "s3-twist.png"));

const p4 = await plate(4);
const cutout2 = await normalizedCutout(
  path.join(inputDir, "짐머맨2.jpg"),
  path.join(outDir, "zimmermann2-cutout.png"),
  { left: 480, top: 0, width: 600, height: 600 },
);
const cutout2Faded = await fadeBottom(cutout2, 0.66);
const s4 = await composeHero(p4, p4, cutout2Faded, { centerX: 555, top: 700, maxWidth: 930, maxHeight: 1120, footerTop: 1615 });
await sharp(s4).flatten({ background: "#000000" }).png({ compressionLevel: 9 }).toFile(path.join(outDir, "s4-climax.png"));

const p5 = await plate(5);
await sharp(p5).png({ compressionLevel: 9 }).toFile(path.join(outDir, "s5-save-cta.png"));

for (const file of ["s1-hook.png", "s2-context.png", "s3-twist.png", "s4-climax.png", "s5-save-cta.png"]) {
  const meta = await sharp(path.join(outDir, file)).metadata();
  if (meta.width !== 1080 || meta.height !== 1920 || meta.format !== "png") throw new Error(`${file} export validation failed`);
}

console.log(JSON.stringify({ output_dir: outDir, files: ["s1-hook.png", "s2-context.png", "s3-twist.png", "s4-climax.png", "s5-save-cta.png"] }, null, 2));
