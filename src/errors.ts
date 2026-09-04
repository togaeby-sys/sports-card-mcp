export type ErrorCode =
  | "PATH_NOT_ABSOLUTE"
  | "PATH_NOT_ALLOWED"
  | "FILE_NOT_FOUND"
  | "INVALID_EXTENSION"
  | "INVALID_IMAGE"
  | "IMAGE_TOO_LARGE"
  | "FONT_NOT_FOUND"
  | "FAL_KEY_MISSING"
  | "INSTAGRAM_TOKEN_MISSING"
  | "INSTAGRAM_API_ERROR"
  | "LEARNING_RECORD_NOT_FOUND"
  | "LEARNING_STORE_ERROR"
  | "API_TIMEOUT"
  | "API_RETRY_EXHAUSTED"
  | "DOWNLOAD_FAILED"
  | "CHATGPT_LOGIN_REQUIRED"
  | "CHATGPT_UI_NOT_READY"
  | "CHATGPT_UI_CHANGED"
  | "CHATGPT_GENERATION_FAILED"
  | "PIPELINE_STEP_FAILED"
  | "INVALID_ARGUMENT";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly stage?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function publicError(error: unknown): {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  stage?: string;
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.stage ? { stage: error.stage } : {}),
    };
  }
  return {
    code: "PIPELINE_STEP_FAILED",
    message: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
    retryable: false,
  };
}
