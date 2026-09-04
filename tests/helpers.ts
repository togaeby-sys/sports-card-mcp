import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config.js";

export async function testConfig(): Promise<AppConfig> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sports-card-mcp-test-"));
  const inputDir = path.join(rootDir, "input");
  const outputDir = path.join(rootDir, "output");
  const assetsDir = path.join(rootDir, "assets");
  await Promise.all([mkdir(inputDir), mkdir(outputDir), mkdir(assetsDir)]);
  return {
    rootDir,
    inputDir,
    outputDir,
    assetsDir,
    cacheDir: path.join(outputDir, ".cache"),
    workDir: path.join(outputDir, ".work"),
    learningDir: path.join(outputDir, ".learning"),
    learningStorePath: path.join(outputDir, ".learning", "knowledge.json"),
    backgroundModel: "mock-background",
    posterModel: "mock-poster",
    segmentationModel: "mock-segmentation",
    apiTimeoutMs: 500,
    apiRetries: 0,
    maxInputBytes: 5 * 1024 * 1024,
    maxDownloadBytes: 5 * 1024 * 1024,
    maxImagePixels: 10_000_000,
    chatGptUiProfileDir: path.join(outputDir, ".chatgpt-ui-profile"),
    chatGptChromeExecutable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chatGptUiTimeoutMs: 2_000,
    chatGptUiRetries: 1,
    instagramApiVersion: "v-test",
    instagramTimeoutMs: 500,
    instagramRetries: 0,
  };
}
