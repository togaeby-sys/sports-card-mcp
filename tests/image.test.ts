import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import { analyzeImage } from "../src/image/analyze.js";
import { compositePlayer } from "../src/image/composite.js";
import { exportReelsCard } from "../src/image/export.js";
import { extractPlayer } from "../src/image/extract.js";
import { buildTextSvg } from "../src/image/text.js";
import type { SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("local image processing", () => {
  it("analyzes supported images and preserves original RGB while applying only mask alpha", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const input = path.join(config.inputDir, "player.png");
    const output = path.join(config.outputDir, "player-cutout.png");
    const pixels = Buffer.from([
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 250, 240, 10,
    ]);
    await sharp(pixels, { raw: { width: 2, height: 2, channels: 3 } }).png().toFile(input);
    const mask = await sharp(Buffer.from([
      255, 255, 255, 255,
      255, 255, 255, 0,
      255, 255, 255, 128,
      255, 255, 255, 255,
    ]), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    let calls = 0;
    const provider: SegmentationProvider = {
      id: "mock:mask-v1",
      async createMask() { calls += 1; return mask; },
    };
    const cache = new FileCache(config, guard);
    const analysis = await analyzeImage(input, guard, config);
    expect(analysis).toMatchObject({ width: 2, height: 2, format: "png" });
    await extractPlayer({ input_image: input, output_path: output }, { guard, config, cache, provider });
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect([...data]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 0,
      0, 0, 255, 128, 250, 240, 10, 255,
    ]);
    const second = path.join(config.outputDir, "player-cutout-2.png");
    const cached = await extractPlayer({ input_image: input, output_path: second }, { guard, config, cache, provider });
    expect(cached.cache_hit).toBe(true);
    expect(calls).toBe(1);
  });

  it("exports an exact 1080x1920 PNG", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const source = path.join(config.outputDir, "source.png");
    const target = path.join(config.outputDir, "card.png");
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "#123456" } }).png().toFile(source);
    await exportReelsCard({ input_image: source, output_path: target }, { guard });
    expect(await sharp(target).metadata()).toMatchObject({ width: 1080, height: 1920, format: "png" });
  });

  it("clips oversized transparent player canvases before compositing", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const player = path.join(config.outputDir, "wide-player.png");
    const background = path.join(config.outputDir, "background.png");
    const target = path.join(config.outputDir, "wide-composite.png");
    await sharp({ create: { width: 1300, height: 500, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg width="1300" height="500"><rect x="350" y="30" width="450" height="470" fill="#fff"/></svg>') }])
      .png()
      .toFile(player);
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#111" } }).png().toFile(background);
    await compositePlayer({
      player_png: player,
      background_image: background,
      x: 760,
      y: 1100,
      scale: 1.35,
      rotation: 0,
      anchor: "center",
      shadow: true,
      rim_light: true,
      output_path: target,
    }, { guard, config });
    expect(await sharp(target).metadata()).toMatchObject({ width: 1080, height: 1920, format: "png" });
  });

  it("embeds a provided font and XML-escapes text without requiring a sample image", async () => {
    const config = await testConfig();
    const font = path.join(config.assetsDir, "korean.ttf");
    const displayFont = path.join(config.assetsDir, "display.ttf");
    await writeFile(font, Buffer.from("fake-font-for-svg-construction"));
    await writeFile(displayFont, Buffer.from("fake-display-font-for-svg-construction"));
    const svg = await buildTextSvg(1080, 1920, font, [{
      text: "김하성 <홈런>", x: 50, y: 50, width: 900, font_size: 80, font_weight: 900, align: "center", style_preset: "impact_gold", font_path: displayFont, scale_x: 0.82, skew_x: -7,
      plate: { fill: "#7A0019", opacity: 0.9, border_color: "#FFB21C", cut_corners: true },
    }]);
    const text = svg.toString("utf8");
    expect(text).toContain("김하성 &lt;홈런&gt;");
    expect(text).toContain("base64,");
    expect(text).toContain("linearGradient");
    expect(text).toContain("feDropShadow");
    expect(text).toContain("CardFont1");
    expect(text).toContain("matrix(0.82");
    expect(text).toContain('fill="#7A0019"');
    expect(text).toContain('fill-opacity="0.9"');
    expect(text).not.toContain('stroke-width="12"');
    await expect(readFile(path.join(config.assetsDir, "missing.ttf"))).rejects.toBeTruthy();
  });
});
