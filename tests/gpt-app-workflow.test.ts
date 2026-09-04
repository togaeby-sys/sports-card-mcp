import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FileCache } from "../src/cache.js";
import type { SegmentationProvider } from "../src/providers/types.js";
import { PathGuard } from "../src/security/paths.js";
import { GptAppReelsWorkflow } from "../src/series/gpt-app.js";
import { testConfig } from "./helpers.js";

async function posterFixture(target: string, upper: string, lower: string): Promise<void> {
  const top = await sharp({ create: { width: 1080, height: 960, channels: 3, background: upper } }).png().toBuffer();
  await sharp({ create: { width: 1080, height: 1920, channels: 3, background: lower } })
    .composite([{ input: top, left: 0, top: 0 }])
    .png()
    .toFile(target);
}

describe("GPT app reels workflow", () => {
  it("prepares prompts without sending the player photo or invoking an API", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const player = path.join(config.inputDir, "player.jpg");
    await sharp({ create: { width: 100, height: 160, channels: 3, background: "#888888" } }).jpeg().toFile(player);
    let invoked = false;
    const segmentationProvider: SegmentationProvider = {
      id: "mock:seg",
      async createMask() {
        invoked = true;
        throw new Error("must not run during prepare");
      },
    };
    const workflow = new GptAppReelsWorkflow({ guard, config, cache: new FileCache(config, guard), segmentationProvider });
    const result = await workflow.prepare({
      series_id: "gpt-queue",
      output_dir: path.join(config.outputDir, "gpt-queue"),
      topic: "12이닝 25실점",
      issue_summary: "기대와 현실",
      team_color: "#F37321",
      photos: [{ image_path: player, preferred_roles: ["context"] }],
      cards: [
        { id: "hook", role: "hook", headline: "25실점", subheadline: "12이닝 만에" },
        { id: "context", role: "context", headline: "무너진 선발", subheadline: "기대했던 그 투수" },
      ],
    });
    expect(result).toMatchObject({
      status: "waiting_for_generation",
      render_provider: "gpt_app",
      estimated_gpt_app_generations: 2,
      player_images_sent_to_gpt_app: false,
      implicit_fal_fallback: false,
    });
    expect(invoked).toBe(false);
    const cards = result.cards as Array<{ prompt_path: string; request_path: string; attachments_to_upload: string[]; forbidden_attachments: string[] }>;
    expect(await readFile(cards[0]!.prompt_path, "utf8")).toContain("25실점");
    expect(await readFile(cards[1]!.prompt_path, "utf8")).toContain("선수, 사람, 얼굴");
    expect(cards[1]!.attachments_to_upload).not.toContain(player);
    expect(cards[1]!.forbidden_attachments).toHaveLength(1);
    expect(path.basename(cards[1]!.forbidden_attachments[0]!)).toBe(path.basename(player));
    const request = JSON.parse(await readFile(cards[1]!.request_path, "utf8")) as { forbidden_attachments: string[]; save_download_as: string };
    expect(request.forbidden_attachments).toEqual(cards[1]!.forbidden_attachments);
    expect(path.isAbsolute(request.save_download_as)).toBe(true);
  });

  it("imports GPT plates, composites only the original player, and finalizes a series", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const player = path.join(config.inputDir, "original-player.png");
    await sharp({ create: { width: 100, height: 160, channels: 3, background: "#E6E6E6" } }).png().toFile(player);
    let segmentationCalls = 0;
    const segmentationProvider: SegmentationProvider = {
      id: "mock:full-mask",
      async createMask() {
        segmentationCalls += 1;
        return sharp(Buffer.alloc(100 * 160, 255), { raw: { width: 100, height: 160, channels: 1 } }).png().toBuffer();
      },
    };
    const workflow = new GptAppReelsWorkflow({ guard, config, cache: new FileCache(config, guard), segmentationProvider });
    const prepared = await workflow.prepare({
      series_id: "gpt-import",
      output_dir: path.join(config.outputDir, "gpt-import"),
      topic: "끝내기",
      issue_summary: "결정적 순간",
      team_color: "#F37321",
      photos: [{ image_path: player }],
      cards: [
        { id: "hook", role: "hook", headline: "끝내기", subheadline: "한 방으로 끝냈다" },
        { id: "climax", role: "climax", headline: "만루홈런", subheadline: "경기를 끝냈다" },
      ],
    });
    const jobManifest = prepared.job_manifest as string;
    const hookPlate = path.join(config.inputDir, "hook-result.png");
    const climaxPlate = path.join(config.inputDir, "climax-result.png");
    await posterFixture(hookPlate, "#F37321", "#08090D");
    await posterFixture(climaxPlate, "#B51E23", "#030405");

    const hook = await workflow.importCard({
      job_manifest: jobManifest,
      card_id: "hook",
      generated_image: hookPlate,
      exact_text_verified: true,
      no_generated_people_verified: true,
    });
    const climax = await workflow.importCard({
      job_manifest: jobManifest,
      card_id: "climax",
      generated_image: climaxPlate,
      exact_text_verified: true,
      no_generated_people_verified: true,
    });
    expect(hook).toMatchObject({ status: "passed", original_player_composited: false, api_calls: 0 });
    expect(climax).toMatchObject({ status: "passed", original_player_composited: true, api_calls: 1 });
    expect(segmentationCalls).toBe(1);
    await expect(sharp(climax.output_path as string).metadata()).resolves.toMatchObject({ width: 1080, height: 1920, format: "png" });

    const final = await workflow.finalize(jobManifest);
    expect(final).toMatchObject({ status: "passed", completed_cards: 2, review_required_cards: [] });
    await expect(sharp(final.review_contact_sheet as string).metadata()).resolves.toMatchObject({ width: 540, height: 480, format: "png" });
    expect(path.isAbsolute(final.delivery_manifest as string)).toBe(true);
  });

  it("keeps a card in review until both manual gates are confirmed", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const segmentationProvider: SegmentationProvider = { id: "mock:unused", async createMask() { throw new Error("unused"); } };
    const workflow = new GptAppReelsWorkflow({ guard, config, cache: new FileCache(config, guard), segmentationProvider });
    const prepared = await workflow.prepare({
      series_id: "gpt-review",
      output_dir: path.join(config.outputDir, "gpt-review"),
      topic: "충격",
      issue_summary: "숫자 훅",
      team_color: "#F37321",
      photos: [],
      cards: [{ id: "hook", role: "hook", headline: "25실점", subheadline: "12이닝" }],
    });
    const plate = path.join(config.inputDir, "result.png");
    await posterFixture(plate, "#F37321", "#08090D");
    const imported = await workflow.importCard({
      job_manifest: prepared.job_manifest as string,
      card_id: "hook",
      generated_image: plate,
      exact_text_verified: false,
      no_generated_people_verified: true,
    });
    expect(imported.status).toBe("review_required");
    expect(imported.review_reasons).toEqual(expect.arrayContaining([expect.stringMatching(/문구/)]));
  });
});
