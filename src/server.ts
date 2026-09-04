import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FileCache } from "./cache.js";
import { loadConfig, type AppConfig } from "./config.js";
import { publicError } from "./errors.js";
import { analyzeImage } from "./image/analyze.js";
import { generateSportsBackground } from "./image/background.js";
import { compositePlayer } from "./image/composite.js";
import { addEffectOverlay } from "./image/effects.js";
import { exportReelsCard } from "./image/export.js";
import { extractPlayer } from "./image/extract.js";
import { renderCardText } from "./image/text.js";
import { generatePosterPlate } from "./image/poster.js";
import { SportsCardPipeline } from "./pipeline.js";
import { FalBackgroundProvider, FalPosterProvider, FalSegmentationProvider } from "./providers/fal.js";
import type { BackgroundProvider, SegmentationProvider } from "./providers/types.js";
import { PathGuard } from "./security/paths.js";
import { analyzeSchema, backgroundSchema, compositeSchema, createSchema, createSeriesSchema, effectSchema, exportSchema, extractSchema, gptAppJobSchema, importGptAppCardSchema, posterPlateSchema, renderTextSchema, setupChatGptUiSchema } from "./schemas.js";
import type { LearningService } from "./learning/service.js";
import { ReelsSeriesPipeline } from "./series/pipeline.js";
import { GptAppReelsWorkflow } from "./series/gpt-app.js";
import { AutomatedReelsWorkflow } from "./series/automated.js";
import { PlaywrightChatGptUiDriver, type ChatGptUiDriver } from "./providers/chatgpt-ui.js";

export interface ServerDependencies {
  config?: AppConfig;
  backgroundProvider?: BackgroundProvider;
  posterProvider?: BackgroundProvider;
  segmentationProvider?: SegmentationProvider;
  learningService?: LearningService;
  chatGptUiDriver?: ChatGptUiDriver;
}

function success(value: unknown) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent };
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: publicError(error) }) }] };
}

function safeHandler<TSchema extends z.ZodTypeAny>(schema: TSchema, handler: (input: z.infer<TSchema>) => Promise<unknown>) {
  return async (input: unknown) => {
    try {
      return success(await handler(schema.parse(input)));
    } catch (error) {
      return failure(error);
    }
  };
}

export async function createMcpServer(overrides: ServerDependencies = {}): Promise<{ server: McpServer; config: AppConfig }> {
  const config = overrides.config ?? loadConfig();
  const guard = new PathGuard(config);
  await guard.initialize();
  const cache = new FileCache(config, guard);
  const backgroundProvider = overrides.backgroundProvider ?? new FalBackgroundProvider(config);
  const posterProvider = overrides.posterProvider ?? new FalPosterProvider(config);
  const segmentationProvider = overrides.segmentationProvider ?? new FalSegmentationProvider(config);
  const pipeline = new SportsCardPipeline({ guard, config, cache, backgroundProvider, posterProvider, segmentationProvider, ...(overrides.learningService ? { learningService: overrides.learningService } : {}) });
  const seriesPipeline = new ReelsSeriesPipeline({ guard, config, cache, posterProvider, segmentationProvider });
  const gptAppWorkflow = new GptAppReelsWorkflow({ guard, config, cache, segmentationProvider });
  const chatGptUiDriver = overrides.chatGptUiDriver ?? new PlaywrightChatGptUiDriver(config, guard);
  const automatedReelsWorkflow = new AutomatedReelsWorkflow({ guard, queue: gptAppWorkflow, driver: chatGptUiDriver });
  const server = new McpServer({ name: "sports-card-mcp", version: "0.6.0" });
  const localWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const apiWrite = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
  const localRead = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool("analyze_image", { title: "선수 이미지 분석", description: "허용된 로컬 이미지를 분석하고 크기, 형식, 해시를 반환합니다.", inputSchema: analyzeSchema.shape, annotations: localRead }, safeHandler(analyzeSchema, (input) => analyzeImage(input.image_path, guard, config)));
  server.registerTool("extract_player", { title: "선수 원본 누끼", description: "세그멘테이션 알파 마스크만 원본 RGB에 적용해 선수 투명 PNG를 만듭니다. 선수 픽셀은 생성 모델로 다시 그리지 않습니다.", inputSchema: extractSchema.shape, annotations: apiWrite }, safeHandler(extractSchema, (input) => extractPlayer(input, { guard, config, cache, provider: segmentationProvider })));
  server.registerTool("generate_sports_background", { title: "스포츠 배경 생성", description: "선수 없이 경기장 배경만 fal.ai로 생성합니다. prompt/seed 캐시와 재사용을 지원합니다.", inputSchema: backgroundSchema.shape, annotations: apiWrite }, safeHandler(backgroundSchema, (input) => generateSportsBackground(input, { guard, config, cache, provider: backgroundProvider })));
  server.registerTool("generate_poster_plate", { title: "영화 포스터급 타이포그래피 플레이트 생성", description: "기준 포스터의 구도와 깊이를 스타일 레퍼런스로 사용해 거대한 금속 입체 제목과 역할별 포스터 판을 생성합니다. subject_slots에 맞춰 원본 선수 누끼 자리를 비우며 사람은 생성하지 않습니다. 이 판 위에는 대형 로컬 SVG 제목을 덮지 말고, 이후 원본 선수 누끼만 합성하십시오. AI 글자는 최종 확인이 필요합니다.", inputSchema: posterPlateSchema.shape, annotations: apiWrite }, safeHandler(posterPlateSchema, (input) => generatePosterPlate(input, { guard, config, cache, provider: posterProvider })));
  server.registerTool("composite_player", { title: "선수 원본 합성", description: "Sharp로 원본 선수 PNG와 배경을 합성합니다.", inputSchema: compositeSchema.shape, annotations: localWrite }, safeHandler(compositeSchema, (input) => compositePlayer(input, { guard, config })));
  server.registerTool("add_effect_overlay", { title: "집중형 스포츠 효과 추가", description: "로컬 SVG로 어두운 텍스트 안전영역, 선수 주변의 국소 조명, 절제된 속도선과 입자를 추가합니다. 레퍼런스형 편집 디자인을 위해 화면 전체를 효과로 덮지 않습니다.", inputSchema: effectSchema.shape, annotations: localWrite }, safeHandler(effectSchema, (input) => addEffectOverlay(input, { guard })));
  server.registerTool("render_card_text", { title: "로컬 편집형 한글 타이포그래피", description: "editorial_local 카드 또는 작은 출처·날짜·해시태그용 도구입니다. cinematic_poster의 거대한 메인 제목을 이 도구로 교체하면 입체감이 무너지므로 사용하지 마십시오. assets 폰트를 SVG에 포함해 정확한 한글을 렌더링합니다.", inputSchema: renderTextSchema.shape, annotations: localWrite }, safeHandler(renderTextSchema, (input) => renderCardText(input, { guard })));
  server.registerTool("export_reels_card", { title: "릴스 카드 내보내기", description: "결과를 정확한 1080×1920 PNG로 내보냅니다.", inputSchema: exportSchema.shape, annotations: localWrite }, safeHandler(exportSchema, (input) => exportReelsCard(input, { guard })));
  server.registerTool("create_sports_card", { title: "영화 포스터급 스포츠 릴스 카드 생성", description: "카드 제작의 기본 도구입니다. poster_style=auto는 일정·증서형을 제외하고 cinematic_poster를 선택하여 선수 없는 AI 포스터 플레이트를 먼저 만들고 원본 선수 누끼를 합성합니다. 거대한 금속 입체 제목, 기울어진 다중 프레임, 배경 등번호, 방사형 폭발과 하단 이중 패널을 한 장면으로 구성합니다. 로컬 편집형이 필요한 경우에만 editorial_local을 지정하십시오. dry-run, 캐시, 배경 재사용과 실패 단계 재개를 지원합니다.", inputSchema: createSchema.shape, annotations: apiWrite }, safeHandler(createSchema, (input) => pipeline.create(input)));
  server.registerTool("create_reels_series", { title: "ChatGPT UI 완전 자동 릴스 카드 제작", description: "Project003이 정한 카드 명세를 받아 Chrome의 ChatGPT 웹에 카드별 프롬프트를 자동 입력하고 스타일 참고 이미지를 첨부합니다. 생성 이미지 다운로드, AI 시각 검수·재시도, 원본 선수 누끼 합성, 1080×1920 PNG와 전달 JSON 생성을 한 호출로 수행합니다. 기본 render_provider=chatgpt_ui이며 선수 사진은 ChatGPT에 보내지 않습니다. manual_gpt_app과 fal_api는 명시적 대체 경로입니다.", inputSchema: createSeriesSchema.shape, annotations: apiWrite }, safeHandler(createSeriesSchema, (input) => input.render_provider === "fal_api" ? seriesPipeline.create(input) : input.render_provider === "manual_gpt_app" ? gptAppWorkflow.prepare(input) : automatedReelsWorkflow.create(input)));
  server.registerTool("setup_chatgpt_ui", { title: "ChatGPT 자동화 브라우저 준비", description: "전용 Chrome 프로필로 ChatGPT를 열고 로그인 상태를 확인합니다. 최초 한 번 열린 창에서 사용자가 로그인하면 이후 create_reels_series가 이미지 생성과 다운로드를 자동 수행합니다. 로그인 정보는 MCP가 읽거나 저장하지 않습니다.", inputSchema: setupChatGptUiSchema.shape, annotations: apiWrite }, safeHandler(setupChatGptUiSchema, (input) => automatedReelsWorkflow.setup(input.wait_for_login_ms)));
  server.registerTool("prepare_gpt_app_reels", { title: "수동 GPT 작업 파일 준비", description: "자동 UI를 사용하지 못하는 예외 상황에만 카드별 프롬프트와 저장 위치를 만듭니다. 일반 릴스 제작에는 create_reels_series를 사용하십시오.", inputSchema: createSeriesSchema.shape, annotations: localWrite }, safeHandler(createSeriesSchema, (input) => gptAppWorkflow.prepare({ ...input, render_provider: "manual_gpt_app" })));
  server.registerTool("import_gpt_app_card", { title: "GPT 앱 카드 결과 가져오기", description: "GPT 앱에서 만든 선수 없는 포스터 판 한 장을 가져와 1080×1920 PNG로 정규화하고, 필요한 경우 원본 선수 누끼를 Sharp로 합성합니다. 문구와 사람 미생성 검수 결과를 기록하며 실패한 카드만 재처리할 수 있습니다.", inputSchema: importGptAppCardSchema.shape, annotations: apiWrite }, safeHandler(importGptAppCardSchema, (input) => gptAppWorkflow.importCard(input)));
  server.registerTool("get_gpt_app_reels_status", { title: "GPT 앱 릴스 작업 상태", description: "GPT 앱 릴스 작업에서 대기·검수·통과한 카드와 다음 파일 경로를 조회합니다.", inputSchema: gptAppJobSchema.shape, annotations: localRead }, safeHandler(gptAppJobSchema, (input) => gptAppWorkflow.status(input.job_manifest)));
  server.registerTool("finalize_gpt_app_reels", { title: "GPT 앱 릴스 시리즈 완료", description: "가져온 모든 카드의 검수 상태를 모아 연락시트와 Project003 전달용 JSON을 생성합니다. 미완료 카드가 있으면 해당 카드만 반환합니다.", inputSchema: gptAppJobSchema.shape, annotations: localWrite }, safeHandler(gptAppJobSchema, (input) => gptAppWorkflow.finalize(input.job_manifest)));

  return { server, config };
}
