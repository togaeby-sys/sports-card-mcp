import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectCardImage } from "../src/image/quality.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("card quality gate", () => {
  it("accepts exact PNG canvas with visible tonal range", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const output = path.join(config.outputDir, "quality.png");
    const bright = await sharp({ create: { width: 1080, height: 960, channels: 3, background: "#F37321" } }).png().toBuffer();
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#07080B" } })
      .composite([{ input: bright, left: 0, top: 0 }])
      .png()
      .toFile(output);
    const report = await inspectCardImage(output, { guard });
    expect(report).toMatchObject({ passed: true, width: 1080, height: 1920, format: "png" });
  });

  it("flags a flat empty image for review", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const output = path.join(config.outputDir, "flat.png");
    await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#050505" } }).png().toFile(output);
    const report = await inspectCardImage(output, { guard });
    expect(report.passed).toBe(false);
    expect(report.checks.tonal_range).toBe(false);
  });
});
