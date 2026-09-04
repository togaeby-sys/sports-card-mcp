import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, "..");
dotenv.config({ path: path.join(packageRoot, ".env"), quiet: true });

function absoluteEnv(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  return path.resolve(value);
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface AppConfig {
  rootDir: string;
  inputDir: string;
  outputDir: string;
  assetsDir: string;
  cacheDir: string;
  workDir: string;
  learningDir: string;
  learningStorePath: string;
  backgroundModel: string;
  posterModel: string;
  posterReferencePath?: string;
  segmentationModel: string;
  fontPath?: string;
  displayFontPath?: string;
  bodyFontPath?: string;
  latinFontPath?: string;
  apiTimeoutMs: number;
  apiRetries: number;
  maxInputBytes: number;
  maxDownloadBytes: number;
  maxImagePixels: number;
  chatGptUiProfileDir: string;
  chatGptChromeExecutable: string;
  chatGptUiTimeoutMs: number;
  chatGptUiRetries: number;
  instagramApiVersion: string;
  instagramTimeoutMs: number;
  instagramRetries: number;
}

export function loadConfig(): AppConfig {
  const rootDir = absoluteEnv("SPORTS_CARD_ROOT", packageRoot);
  const outputDir = absoluteEnv("SPORTS_CARD_OUTPUT_DIR", path.join(rootDir, "output"));
  const assetsDir = absoluteEnv("SPORTS_CARD_ASSETS_DIR", path.join(rootDir, "assets"));
  const fontPath = process.env.SPORTS_CARD_FONT_PATH;
  return {
    rootDir,
    inputDir: absoluteEnv("SPORTS_CARD_INPUT_DIR", path.join(rootDir, "input")),
    outputDir,
    assetsDir,
    cacheDir: path.join(outputDir, ".cache"),
    workDir: path.join(outputDir, ".work"),
    learningDir: path.join(outputDir, ".learning"),
    learningStorePath: path.join(outputDir, ".learning", "knowledge.json"),
    backgroundModel: process.env.FAL_BACKGROUND_MODEL ?? "fal-ai/flux-pro/kontext/text-to-image",
    posterModel: process.env.FAL_POSTER_MODEL ?? "fal-ai/flux-pro/kontext",
    posterReferencePath: absoluteEnv("SPORTS_CARD_POSTER_REFERENCE", path.join(assetsDir, "kim-jaehyun-ai-typography-plate-v2.png")),
    segmentationModel: process.env.FAL_SEGMENTATION_MODEL ?? "fal-ai/birefnet/v2",
    ...(fontPath ? { fontPath: path.resolve(fontPath) } : {}),
    displayFontPath: absoluteEnv("SPORTS_CARD_DISPLAY_FONT_PATH", path.join(assetsDir, "fonts", "black-han-sans", "BlackHanSans-Regular.ttf")),
    bodyFontPath: absoluteEnv("SPORTS_CARD_BODY_FONT_PATH", path.join(assetsDir, "fonts", "do-hyeon", "DoHyeon-Regular.ttf")),
    latinFontPath: absoluteEnv("SPORTS_CARD_LATIN_FONT_PATH", path.join(assetsDir, "fonts", "anton", "Anton-Regular.ttf")),
    apiTimeoutMs: intEnv("FAL_TIMEOUT_MS", 120_000),
    apiRetries: intEnv("FAL_RETRIES", 2),
    maxInputBytes: intEnv("MAX_INPUT_BYTES", 50 * 1024 * 1024),
    maxDownloadBytes: intEnv("MAX_DOWNLOAD_BYTES", 40 * 1024 * 1024),
    maxImagePixels: intEnv("MAX_IMAGE_PIXELS", 80_000_000),
    chatGptUiProfileDir: absoluteEnv("CHATGPT_UI_PROFILE_DIR", path.join(outputDir, ".chatgpt-ui-profile")),
    chatGptChromeExecutable: absoluteEnv("CHATGPT_CHROME_EXECUTABLE", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    chatGptUiTimeoutMs: intEnv("CHATGPT_UI_TIMEOUT_MS", 10 * 60_000),
    chatGptUiRetries: intEnv("CHATGPT_UI_RETRIES", 2),
    instagramApiVersion: process.env.INSTAGRAM_API_VERSION ?? "v25.0",
    instagramTimeoutMs: intEnv("INSTAGRAM_TIMEOUT_MS", 30_000),
    instagramRetries: intEnv("INSTAGRAM_RETRIES", 2),
  };
}
