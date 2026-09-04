import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import { SportsCardPipeline } from "../src/pipeline.js";
import type { BackgroundProvider, SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("SportsCardPipeline dry_run", () => {
  it("returns expected API count and never invokes a provider", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const input = path.join(config.inputDir, "player.webp");
    await sharp({ create: { width: 20, height: 30, channels: 3, background: "blue" } }).webp().toFile(input);
    const font = path.join(config.assetsDir, "korean.ttf");
    await writeFile(font, "font");
    let invoked = false;
    const backgroundProvider: BackgroundProvider = { id: "mock:bg", async generate() { invoked = true; throw new Error("must not run"); } };
    const segmentationProvider: SegmentationProvider = { id: "mock:seg", async createMask() { invoked = true; throw new Error("must not run"); } };
    const pipeline = new SportsCardPipeline({ guard, config, cache: new FileCache(config, guard), backgroundProvider, segmentationProvider });
    const result = await pipeline.create({
      player_image: input,
      output_path: path.join(config.outputDir, "final.png"),
      template: "night_stadium",
      background_prompt: "rainy playoff night",
      team_color: "#003478",
      headline: "승리",
      score_text: "7 : 3",
      subheadline: "결승 홈런",
      footer: "2026 POSTSEASON",
      player_position: { x: 540, y: 1080, scale: 1, anchor: "center" },
      text_safe_area: { x: 80, y: 80, width: 920, height: 1760 },
      font_path: font,
      seed: 42,
      dry_run: true,
    });
    expect(result).toMatchObject({ dry_run: true, estimated_api_calls: 2, cache: { player: false, background: false } });
    expect(invoked).toBe(false);
  });
});
