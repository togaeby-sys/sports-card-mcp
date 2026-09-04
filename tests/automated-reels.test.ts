import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import { AppError } from "../src/errors.js";
import type { ChatGptUiDriver, ChatGptUiGenerationRequest } from "../src/providers/chatgpt-ui.js";
import type { SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { AutomatedReelsWorkflow } from "../src/series/automated.js";
import { GptAppReelsWorkflow } from "../src/series/gpt-app.js";
import { testConfig } from "./helpers.js";

describe("automated ChatGPT UI reels workflow", () => {
  it("generates, imports, verifies and finalizes without a human generation step", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const segmentationProvider: SegmentationProvider = { id: "mock:unused", async createMask() { throw new Error("unused"); } };
    const queue = new GptAppReelsWorkflow({ guard, config, cache: new FileCache(config, guard), segmentationProvider });
    const generatedRequests: ChatGptUiGenerationRequest[] = [];
    const driver: ChatGptUiDriver = {
      async setup() {
        return { ready: true, login_required: false, url: "https://chatgpt.com/", profile_dir: config.chatGptUiProfileDir };
      },
      async generate(request) {
        generatedRequests.push(request);
        const upper = await sharp({ create: { width: 1080, height: 960, channels: 3, background: "#F37321" } }).png().toBuffer();
        await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#08090D" } })
          .composite([{ input: upper, left: 0, top: 0 }])
          .png()
          .toFile(request.outputPath);
        return {
          output_path: request.outputPath,
          attempts: 1,
          qa: { exact_text: true, no_people: true, errors: [], source: "chatgpt_visual_self_review" },
        };
      },
    };
    const automated = new AutomatedReelsWorkflow({ guard, queue, driver });
    const result = await automated.create({
      series_id: "auto-ui",
      output_dir: path.join(config.outputDir, "auto-ui"),
      topic: "충격 기록",
      issue_summary: "첫 장 훅",
      team_color: "#F37321",
      photos: [],
      cards: [{ id: "hook", role: "hook", hero_number: "25", headline: "25실점", subheadline: "12이닝" }],
    });
    expect(result).toMatchObject({
      status: "passed",
      render_provider: "chatgpt_ui",
      automatic_ui_generation: true,
      human_generation_step_required: false,
      completed_cards: 1,
      total_ui_attempts: 1,
    });
    expect(generatedRequests).toHaveLength(1);
    expect(generatedRequests[0]!.exactCopy).toEqual(expect.arrayContaining(["25", "25실점", "12이닝"]));
    expect(generatedRequests[0]!.attachments).not.toContain(expect.stringContaining("player"));
  });

  it("returns an actionable login error before generation", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const segmentationProvider: SegmentationProvider = { id: "mock:unused", async createMask() { throw new Error("unused"); } };
    const queue = new GptAppReelsWorkflow({ guard, config, cache: new FileCache(config, guard), segmentationProvider });
    const driver: ChatGptUiDriver = {
      async setup() {
        return { ready: false, login_required: true, url: "https://chatgpt.com/", profile_dir: config.chatGptUiProfileDir };
      },
      async generate() {
        throw new Error("must not generate");
      },
    };
    const automated = new AutomatedReelsWorkflow({ guard, queue, driver });
    await expect(automated.create({
      series_id: "login-required",
      output_dir: path.join(config.outputDir, "login-required"),
      topic: "test",
      issue_summary: "test",
      team_color: "#F37321",
      photos: [],
      cards: [{ id: "hook", role: "hook", headline: "훅", subheadline: "설명" }],
    })).rejects.toMatchObject<AppError>({ code: "CHATGPT_LOGIN_REQUIRED", retryable: true });
  });
});
