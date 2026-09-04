import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import { generatePosterPlate, makePosterPlatePrompt } from "../src/image/poster.js";
import type { BackgroundProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("cinematic poster plate", () => {
  it("locks the blockbuster composition and exact supplied copy", () => {
    const prompt = makePosterPlatePrompt({
      kicker: "KBO HIGHLIGHT",
      headline: "끝내기 만루홈런",
      player_name: "김재현",
      jersey_number: "22",
      hero_number: "22",
      subheadline: "한 방으로 경기를 끝냈다",
      english_tagline: "WALK-OFF GRAND SLAM",
      team_color: "#7A0019",
      accent_color: "#F6B91E",
      intensity: 10,
      output_path: "/allowed/output/poster.png",
    });
    expect(prompt).toContain('giant main Korean headline: "끝내기 만루홈런"');
    expect(prompt).toContain('black nameplate: "김재현 · #22"');
    expect(prompt).toContain('bottom English plaque: "WALK-OFF GRAND SLAM"');
    expect(prompt).toContain("never use flat rounded rectangles");
    expect(prompt).toContain("Do not draw a player");
  });

  it("changes composition by narrative role and keeps no-player cards visually occupied", () => {
    const prompt = makePosterPlatePrompt({
      kicker: "KBO · HOOK",
      headline: "25실점",
      player_name: "",
      hero_number: "25",
      subheadline: "12이닝 만에 역대급 오점",
      english_tagline: "STOP THE SCROLL",
      team_color: "#F37321",
      accent_color: "#FF8A00",
      intensity: 10,
      narrative_role: "hook",
      layout_family: "number_shock",
      layout_direction: "A single shocking number dominates the canvas.",
      subject_slots: 0,
      output_path: "/allowed/output/hook.png",
    });
    expect(prompt).toContain("Narrative role: hook");
    expect(prompt).toContain("Do not reserve an empty athlete hole");
    expect(prompt).toContain("Avoid dead empty zones");
  });

  it("uses a style reference, caches the plate, and needs no sample photo", async () => {
    const config = await testConfig();
    const reference = path.join(config.assetsDir, "poster-reference.png");
    await sharp({ create: { width: 16, height: 24, channels: 3, background: "#120507" } }).png().toFile(reference);
    config.posterReferencePath = reference;
    const guard = new PathGuard(config);
    await guard.initialize();
    const cache = new FileCache(config, guard);
    let calls = 0;
    let receivedReference = false;
    const provider: BackgroundProvider = {
      id: "mock:poster-v1",
      async generate(request) {
        calls += 1;
        receivedReference = Boolean(request.referenceImage?.length);
        return sharp({ create: { width: 90, height: 160, channels: 3, background: "#C87308" } }).png().toBuffer();
      },
    };
    const input = {
      kicker: "KBO HIGHLIGHT",
      headline: "끝내기 만루홈런",
      player_name: "김재현",
      jersey_number: "22",
      hero_number: "22",
      subheadline: "한 방으로 경기를 끝냈다",
      english_tagline: "WALK-OFF GRAND SLAM",
      team_color: "#7A0019",
      accent_color: "#F6B91E",
      intensity: 10,
      output_path: path.join(config.outputDir, "poster-1.png"),
      seed: 22,
    };
    const first = await generatePosterPlate(input, { guard, config, cache, provider });
    const second = await generatePosterPlate({ ...input, output_path: path.join(config.outputDir, "poster-2.png") }, { guard, config, cache, provider });
    expect(first).toMatchObject({ cache_hit: false, api_calls: 1, typography_verification_required: true });
    expect(second).toMatchObject({ cache_hit: true, api_calls: 0 });
    expect(receivedReference).toBe(true);
    expect(calls).toBe(1);
    expect(await sharp(second.output_path).metadata()).toMatchObject({ width: 1080, height: 1920, format: "png" });
  });
});
