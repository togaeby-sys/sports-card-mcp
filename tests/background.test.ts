import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import { generateSportsBackground } from "../src/image/background.js";
import type { BackgroundProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("background generation cache", () => {
  it("caches the same normalized prompt and seed and forces a people-free prompt", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    let calls = 0;
    let receivedPrompt = "";
    const image = await sharp({ create: { width: 90, height: 160, channels: 3, background: "#201030" } }).png().toBuffer();
    const provider: BackgroundProvider = {
      id: "mock:bg-v1",
      async generate(request) {
        calls += 1;
        receivedPrompt = request.prompt;
        return image;
      },
    };
    const cache = new FileCache(config, guard);
    const base = {
      theme: "night stadium",
      stadium_type: "baseball park",
      lighting: "flood light",
      team_color: "#ff0000",
      intensity: 7,
      text_safe_area: { x: 50, y: 50, width: 900, height: 1700 },
      aspect_ratio: "9:16",
      seed: 10,
    };
    const first = await generateSportsBackground({ ...base, output_path: path.join(config.outputDir, "bg-1.png") }, { guard, config, cache, provider });
    const second = await generateSportsBackground({ ...base, output_path: path.join(config.outputDir, "bg-2.png") }, { guard, config, cache, provider });
    expect(first).toMatchObject({ cache_hit: false, api_calls: 1 });
    expect(second).toMatchObject({ cache_hit: true, api_calls: 0 });
    expect(calls).toBe(1);
    expect(receivedPrompt).toMatch(/No people, no player/);
    expect(await sharp(second.output_path).metadata()).toMatchObject({ width: 1080, height: 1920, format: "png" });
  });
});
