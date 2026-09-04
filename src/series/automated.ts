import { readFile } from "node:fs/promises";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { ChatGptUiDriver } from "../providers/chatgpt-ui.js";
import type { PathGuard } from "../security/paths.js";
import type { CreateSeriesInput } from "./director.js";
import type { GptAppReelsWorkflow } from "./gpt-app.js";

const requestSchema = z.object({
  request_id: z.string(),
  prompt: z.string(),
  attachments_to_upload: z.array(z.string()),
  forbidden_attachments: z.array(z.string()),
  exact_copy: z.array(z.string()),
  save_download_as: z.string(),
}).passthrough();

interface PreparedCard {
  id: string;
  role: string;
  status: string;
  request_path: string;
  expected_image_path: string;
  final_output_path: string;
}

export class AutomatedReelsWorkflow {
  constructor(private readonly dependencies: {
    guard: PathGuard;
    queue: GptAppReelsWorkflow;
    driver: ChatGptUiDriver;
  }) {}

  async setup(waitForLoginMs = 0): Promise<Record<string, unknown>> {
    const status = await this.dependencies.driver.setup(waitForLoginMs);
    return {
      status: status.ready ? "ready" : "login_required",
      render_provider: "chatgpt_ui",
      ...status,
      next_action: status.ready
        ? "create_reels_series를 호출하면 GPT 이미지 생성부터 원본 선수 합성까지 자동 실행됩니다."
        : "열린 자동화용 Chrome 창에서 ChatGPT에 로그인한 뒤 setup_chatgpt_ui를 다시 호출하세요.",
    };
  }

  async create(input: CreateSeriesInput): Promise<Record<string, unknown>> {
    const prepared = await this.dependencies.queue.prepare({ ...input, render_provider: "gpt_app" });
    if (input.dry_run) {
      return {
        ...prepared,
        render_provider: "chatgpt_ui",
        automatic_ui_generation: true,
        human_generation_step_required: false,
        next_action: "dry_run을 끄고 다시 호출하면 ChatGPT 웹 생성, 다운로드, 원본 선수 합성과 검수를 자동 실행합니다.",
      };
    }

    const setup = await this.dependencies.driver.setup(3_000);
    if (!setup.ready) {
      throw new AppError(
        "CHATGPT_LOGIN_REQUIRED",
        "자동화용 Chrome에 ChatGPT 로그인이 필요합니다. setup_chatgpt_ui를 실행해 열린 창에서 한 번 로그인한 뒤 같은 요청을 다시 실행하세요.",
        true,
        "chatgpt_login",
      );
    }

    const jobManifest = prepared.job_manifest;
    if (typeof jobManifest !== "string") throw new AppError("PIPELINE_STEP_FAILED", "GPT 앱 작업 명세 경로가 생성되지 않았습니다.");
    const cards = prepared.cards as PreparedCard[];
    const generated: Array<Record<string, unknown>> = [];
    for (const card of cards) {
      if (card.status === "passed" && !input.retry_cards?.includes(card.id)) continue;
      const requestPath = await this.dependencies.guard.readable(card.request_path, ["output"]);
      let request: z.infer<typeof requestSchema>;
      try {
        request = requestSchema.parse(JSON.parse(await readFile(requestPath, "utf8")));
      } catch {
        throw new AppError("INVALID_ARGUMENT", `${card.id}: GPT UI request JSON이 손상되었습니다. create_reels_series를 다시 실행하세요.`, false, `${card.id}:read_ui_request`);
      }
      if (request.forbidden_attachments.some((forbidden) => request.attachments_to_upload.includes(forbidden))) {
        throw new AppError("PATH_NOT_ALLOWED", `${card.id}: 선수 원본 사진이 ChatGPT 첨부 목록에 포함되어 자동화를 중단했습니다.`, false, `${card.id}:attachment_safety_gate`);
      }
      try {
        const ui = await this.dependencies.driver.generate({
          requestId: request.request_id,
          prompt: request.prompt,
          attachments: request.attachments_to_upload,
          outputPath: request.save_download_as,
          exactCopy: request.exact_copy,
        });
        const imported = await this.dependencies.queue.importCard({
          job_manifest: jobManifest,
          card_id: card.id,
          generated_image: ui.output_path,
          exact_text_verified: ui.qa.exact_text,
          no_generated_people_verified: ui.qa.no_people,
          ...(input.force || input.retry_cards?.includes(card.id) ? { force: true } : {}),
        });
        generated.push({ card_id: card.id, ui_attempts: ui.attempts, ui_qa: ui.qa, import: imported });
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(error.code, `${card.id}: ${error.message}`, error.retryable, error.stage ?? `${card.id}:chatgpt_ui_generation`);
        }
        throw new AppError("CHATGPT_GENERATION_FAILED", `${card.id}: ChatGPT UI 자동 생성 실패`, true, `${card.id}:chatgpt_ui_generation`);
      }
    }

    const finalized = await this.dependencies.queue.finalize(jobManifest);
    return {
      ...finalized,
      render_provider: "chatgpt_ui",
      automatic_ui_generation: true,
      human_generation_step_required: false,
      generated_cards: generated,
      total_ui_attempts: generated.reduce((sum, card) => sum + Number(card.ui_attempts ?? 0), 0),
    };
  }
}
