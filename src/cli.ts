#!/usr/bin/env node
/**
 * 무인 자동 제작용 CLI.
 *
 * MCP stdio 서버(`index.ts`)는 Claude Code 세션이 있어야만 동작하므로 GitHub Actions 같은
 * 무인 환경에서 쓸 수 없다. 이 진입점은 같은 `SportsCardPipeline` 을 JSON 명세로 직접 호출한다.
 * MCP 프로토콜을 우회하는 것이 아니라 같은 엔진에 다른 입구를 하나 낸 것이다.
 *
 * 사용:
 *   node dist/cli.js --spec card.json
 *   node dist/cli.js --spec card.json --pretty
 *   cat card.json | node dist/cli.js
 *
 * 명세는 create_sports_card 입력 스키마와 동일하다. 다만 무인 환경에서는
 * poster_style 을 반드시 "editorial_local" 로 둔다 — cinematic_poster 는 AI 가 한글을 쓰므로
 * 철자 검수가 필요하고, 검수할 사람이 없는 자리에서는 쓸 수 없다.
 */
import { readFile } from "node:fs/promises";
import process from "node:process";

import { loadConfig } from "./config.js";
import { AppError } from "./errors.js";
import { FileCache } from "./cache.js";
import { logger } from "./logger.js";
import { SportsCardPipeline } from "./pipeline.js";
import { FalBackgroundProvider, FalPosterProvider, FalSegmentationProvider } from "./providers/fal.js";
import { PathGuard } from "./security/paths.js";
import { createSchema } from "./schemas.js";

interface CliOptions {
  specPath?: string;
  pretty: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--spec" || arg === "-s") {
      const value = argv[index + 1];
      if (!value) throw new AppError("INVALID_ARGUMENT", "--spec 뒤에 JSON 파일 경로가 필요합니다.");
      options.specPath = value;
      index += 1;
    } else if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write([
        "sports-card CLI — 무인 카드 제작",
        "",
        "  node dist/cli.js --spec <card.json> [--pretty]",
        "  cat card.json | node dist/cli.js",
        "",
        "명세는 create_sports_card 입력과 동일합니다.",
        "무인 환경에서는 poster_style: \"editorial_local\" 을 쓰세요.",
        "",
      ].join("\n"));
      process.exit(0);
    }
  }
  return options;
}

async function readSpec(specPath?: string): Promise<unknown> {
  const raw = specPath
    ? await readFile(specPath, "utf8")
    : await new Promise<string>((resolve, reject) => {
      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { buffer += chunk; });
      process.stdin.on("end", () => { resolve(buffer); });
      process.stdin.on("error", reject);
    });
  if (!raw.trim()) throw new AppError("INVALID_ARGUMENT", "카드 명세가 비어 있습니다. --spec 경로나 stdin 을 확인하세요.");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new AppError("INVALID_ARGUMENT", `카드 명세 JSON 파싱 실패: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const spec = await readSpec(options.specPath);
  const input = createSchema.parse(spec);

  // 서버(`createMcpServer`)와 같은 조립. Playwright 드라이버만 뺀다 — 무인 환경에는 Chrome 이 없다.
  const config = loadConfig();
  const guard = new PathGuard(config);
  await guard.initialize();
  const cache = new FileCache(config, guard);
  const pipeline = new SportsCardPipeline({
    guard,
    config,
    cache,
    backgroundProvider: new FalBackgroundProvider(config),
    posterProvider: new FalPosterProvider(config),
    segmentationProvider: new FalSegmentationProvider(config),
  });

  const result = await pipeline.create(input);
  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);

  // 기술 검수와 타이포 검수를 모두 통과해야 게시 가능한 완성본이다.
  // 무인 실행에서는 사람이 볼 수 없으므로 통과하지 못한 카드는 종료 코드로 알린다.
  const status = (result as { status?: string }).status;
  if (status && status !== "passed") {
    logger.error(`카드가 검수를 통과하지 못했습니다: status=${status}`);
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const payload = error instanceof AppError
    ? { code: error.code, message: error.message, ...(error.stage ? { stage: error.stage } : {}) }
    : { code: "UNEXPECTED", message: error instanceof Error ? error.message : String(error) };
  process.stderr.write(`${JSON.stringify({ error: payload })}\n`);
  process.exitCode = 1;
});
