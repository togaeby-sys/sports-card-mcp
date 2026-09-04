import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileCache } from "../src/cache.js";
import { InstagramInsightsClient } from "../src/learning/instagram.js";
import { LearningService } from "../src/learning/service.js";
import { LearningStore } from "../src/learning/store.js";
import { SportsCardPipeline } from "../src/pipeline.js";
import type { BackgroundProvider, SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

async function setup() {
  const config = await testConfig();
  const guard = new PathGuard(config);
  await guard.initialize();
  const store = new LearningStore(config);
  await store.initialize();
  const service = new LearningService(store, new InstagramInsightsClient(config), guard);
  const output = path.join(config.outputDir, "card.png");
  await sharp({ create: { width: 20, height: 30, channels: 4, background: "red" } }).png().toFile(output);
  return { config, guard, store, service, output };
}

function features(density: "balanced" | "maximum", includePlayer = true) {
  return LearningService.featuresFromGeneration({
    issue_type: "home_run",
    template: "cinematic_red",
    layout_density: density,
    visual_intensity: density === "maximum" ? 10 : 5,
    include_player: includePlayer,
    headline: "홈런",
    hero_type: "number",
    cta_type: "save",
  });
}

describe("card learning loop", () => {
  it("registers cards, publication metadata and manual insights without exposing external tokens", async () => {
    const { service, output } = await setup();
    const card = await service.registerCard({ card_id: "card-1", output_paths: [output], headline: "끝내기 홈런", features: features("maximum") });
    const published = await service.registerPublished({ card_id: card.id, instagram_media_id: "178900001", reel_duration_ms: 12_000 });
    const insight = await service.recordInsights({
      card_id: card.id,
      source: "manual_owned",
      metrics: { reach: 1_000, likes: 120, saves: 40, shares: 25, comments: 8, avg_watch_time_ms: 9_000, skip_rate: 0.2 },
    });
    expect(published.instagram_media_id).toBe("178900001");
    expect(insight.metrics.saves).toBe(40);
  });

  it("learns a repeatable density recommendation only after minimum samples", async () => {
    const { service, output } = await setup();
    for (let index = 0; index < 6; index += 1) {
      const maximum = index < 3;
      const cardId = `card-${index}`;
      await service.registerCard({ card_id: cardId, output_paths: [output], headline: maximum ? "강한 홈런" : "홈런 소식", features: features(maximum ? "maximum" : "balanced") });
      await service.recordInsights({
        card_id: cardId,
        source: "manual_owned",
        metrics: maximum
          ? { reach: 2_000, likes: 260, saves: 120, shares: 90, comments: 20 }
          : { reach: 2_000, likes: 80, saves: 15, shares: 8, comments: 4 },
      });
    }
    const result = service.getRecommendations({ issue_type: "home_run", min_reach: 100, min_samples: 3, min_score_lift: 5 });
    const recommendations = result.recommendations as Array<{ feature: string; preferred_value: string }>;
    expect(recommendations).toContainEqual(expect.objectContaining({ feature: "layout_density", preferred_value: "maximum" }));
  });

  it("applies adopted defaults to auto card generation while preserving dry-run", async () => {
    const { config, guard, service, output } = await setup();
    await service.registerCard({ card_id: "evidence", output_paths: [output], headline: "증거", features: features("maximum") });
    await service.adoptRule({
      issue_type: "home_run",
      settings: { layout_density: "maximum", visual_intensity: 10 },
      reason: "저장률과 공유율이 반복적으로 높음",
      evidence_card_ids: ["evidence"],
      confidence: 0.85,
    });
    const input = path.join(config.inputDir, "player.png");
    await sharp({ create: { width: 20, height: 30, channels: 3, background: "blue" } }).png().toFile(input);
    const font = path.join(config.assetsDir, "korean.ttf");
    await writeFile(font, "font");
    const backgroundProvider: BackgroundProvider = { id: "mock:bg", async generate() { throw new Error("must not run"); } };
    const segmentationProvider: SegmentationProvider = { id: "mock:seg", async createMask() { throw new Error("must not run"); } };
    const pipeline = new SportsCardPipeline({ guard, config, cache: new FileCache(config, guard), backgroundProvider, segmentationProvider, learningService: service });
    const result = await pipeline.create({
      player_image: input,
      output_path: path.join(config.outputDir, "final.png"),
      template: "auto",
      issue_type: "home_run",
      background_prompt: "night stadium",
      team_color: "#7A0019",
      headline: "홈런",
      score_text: "",
      subheadline: "",
      footer: "",
      text_safe_area: { x: 60, y: 50, width: 960, height: 1810 },
      font_path: font,
      dry_run: true,
    });
    expect(result.design_strategy).toMatchObject({ density: "maximum", intensity: 10 });
    expect(result.learning).toMatchObject({ applied_rule_ids: [expect.any(String)] });
  });
});

describe("Instagram Insights client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });

  it("uses bearer authorization and maps official metric names", async () => {
    const config = await testConfig();
    process.env.INSTAGRAM_ACCESS_TOKEN = "secret-test-token";
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-test-token" });
      return new Response(JSON.stringify({ data: [
        { name: "reach", values: [{ value: 1000 }] },
        { name: "saved", values: [{ value: 30 }] },
        { name: "shares", values: [{ value: 20 }] },
        { name: "ig_reels_avg_watch_time", values: [{ value: 8500 }] },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const metrics = await new InstagramInsightsClient(config).getMediaInsights("178900001", ["reach", "saved", "shares", "ig_reels_avg_watch_time"]);
    expect(metrics).toEqual({ reach: 1000, saves: 30, shares: 20, avg_watch_time_ms: 8500 });
  });
});
