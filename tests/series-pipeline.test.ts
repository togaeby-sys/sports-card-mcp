import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import type { BackgroundProvider, SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { ReelsSeriesPipeline } from "../src/series/pipeline.js";
import { testConfig } from "./helpers.js";

describe("ReelsSeriesPipeline dry run", () => {
  it("plans role-specific cards without invoking providers", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const photo = path.join(config.inputDir, "player.jpg");
    await sharp({ create: { width: 80, height: 120, channels: 3, background: "#777777" } }).jpeg().toFile(photo);
    let invoked = false;
    const posterProvider: BackgroundProvider = { id: "mock:poster", async generate() { invoked = true; throw new Error("must not run"); } };
    const segmentationProvider: SegmentationProvider = { id: "mock:seg", async createMask() { invoked = true; throw new Error("must not run"); } };
    const pipeline = new ReelsSeriesPipeline({ guard, config, cache: new FileCache(config, guard), posterProvider, segmentationProvider });
    const result = await pipeline.create({
      series_id: "dry-series",
      output_dir: path.join(config.outputDir, "dry-series"),
      topic: "충격 기록",
      issue_summary: "기대와 현실",
      team_color: "#F37321",
      photos: [{ image_path: photo }],
      cards: [
        { role: "hook", headline: "25실점", subheadline: "12이닝 만에" },
        { role: "context", headline: "무너진 선발", subheadline: "기대했던 그 투수" },
      ],
      dry_run: true,
    });
    expect(result).toMatchObject({
      dry_run: true,
      status: "planned",
      estimated_api_calls: 3,
      estimated_calls: { poster: 2, segmentation: 1 },
    });
    expect((result.cards as Array<{ photo_indices: number[] }>).map((card) => card.photo_indices)).toEqual([[], [0]]);
    expect(invoked).toBe(false);
  });

  it("renders no-player and original-player cards through the cinematic-only path", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const photo = path.join(config.inputDir, "original-player.png");
    await sharp({ create: { width: 100, height: 160, channels: 3, background: "#E6E6E6" } }).png().toFile(photo);
    const posterProvider: BackgroundProvider = {
      id: "mock:poster-gradient",
      async generate() {
        const upper = await sharp({ create: { width: 1080, height: 960, channels: 3, background: "#F37321" } }).png().toBuffer();
        return sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#08090D" } })
          .composite([{ input: upper, left: 0, top: 0 }])
          .png()
          .toBuffer();
      },
    };
    const segmentationProvider: SegmentationProvider = {
      id: "mock:full-mask",
      async createMask() {
        return sharp(Buffer.alloc(100 * 160, 255), { raw: { width: 100, height: 160, channels: 1 } }).png().toBuffer();
      },
    };
    const pipeline = new ReelsSeriesPipeline({ guard, config, cache: new FileCache(config, guard), posterProvider, segmentationProvider });
    const outputDir = path.join(config.outputDir, "rendered-series");
    const result = await pipeline.create({
      series_id: "rendered-series",
      output_dir: outputDir,
      topic: "충격 기록",
      issue_summary: "기대와 현실",
      team_color: "#F37321",
      photos: [{ image_path: photo }],
      cards: [
        { id: "hook", role: "hook", headline: "25실점", subheadline: "12이닝 만에" },
        { id: "context", role: "context", headline: "무너진 선발", subheadline: "기대했던 그 투수" },
      ],
    });
    expect(result).toMatchObject({ status: "review_required", completed_cards: 2, api_calls: 3, review_required_cards: 2 });
    const cards = result.cards as Array<{ output_path: string; player_photo_indices: number[]; quality: { passed: boolean } }>;
    expect(cards.map((card) => card.player_photo_indices)).toEqual([[], [0]]);
    expect(cards.every((card) => card.quality.passed)).toBe(true);
    await expect(sharp(cards[0]!.output_path).metadata()).resolves.toMatchObject({ width: 1080, height: 1920, format: "png" });
    await expect(sharp(result.review_contact_sheet as string).metadata()).resolves.toMatchObject({ width: 540, height: 480, format: "png" });
  });
});
