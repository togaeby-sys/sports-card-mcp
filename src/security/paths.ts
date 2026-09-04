import { access, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";

export type RootKind = "input" | "output" | "assets";
const IMAGE_INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function existingAncestor(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) throw new AppError("PATH_NOT_ALLOWED", "경로의 기존 상위 폴더를 확인할 수 없습니다.");
      current = parent;
    }
  }
}

export class PathGuard {
  private readonly roots: Record<RootKind, string>;

  constructor(private readonly config: AppConfig) {
    this.roots = {
      input: path.resolve(config.inputDir),
      output: path.resolve(config.outputDir),
      assets: path.resolve(config.assetsDir),
    };
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.roots.input, { recursive: true }),
      mkdir(this.roots.output, { recursive: true }),
      mkdir(this.roots.assets, { recursive: true }),
      mkdir(this.config.cacheDir, { recursive: true }),
      mkdir(this.config.workDir, { recursive: true }),
    ]);
    for (const kind of Object.keys(this.roots) as RootKind[]) {
      this.roots[kind] = await realpath(this.roots[kind]);
    }
  }

  private requireAbsolute(target: string): string {
    if (!path.isAbsolute(target)) {
      throw new AppError("PATH_NOT_ABSOLUTE", `절대 경로가 필요합니다: ${target}`);
    }
    return path.resolve(target);
  }

  async readable(target: string, kinds: RootKind[] = ["input", "output", "assets"]): Promise<string> {
    const resolved = this.requireAbsolute(target);
    try {
      await access(resolved, constants.R_OK);
    } catch {
      throw new AppError("FILE_NOT_FOUND", `파일을 찾거나 읽을 수 없습니다: ${resolved}`);
    }
    const actual = await realpath(resolved);
    if (!kinds.some((kind) => isInside(actual, this.roots[kind]))) {
      throw new AppError("PATH_NOT_ALLOWED", "허용된 input, output, assets 폴더 밖의 파일은 읽을 수 없습니다.");
    }
    const info = await stat(actual);
    if (!info.isFile()) throw new AppError("FILE_NOT_FOUND", `파일 경로가 아닙니다: ${resolved}`);
    return actual;
  }

  async writable(target: string, extension = ".png", createParent = true): Promise<string> {
    const resolved = this.requireAbsolute(target);
    if (path.extname(resolved).toLowerCase() !== extension) {
      throw new AppError("INVALID_EXTENSION", `출력 확장자는 ${extension}여야 합니다.`);
    }
    const ancestor = await existingAncestor(path.dirname(resolved));
    if (!isInside(ancestor, this.roots.output)) {
      throw new AppError("PATH_NOT_ALLOWED", "출력은 허용된 output 폴더 안에만 쓸 수 있습니다.");
    }
    if (await this.exists(resolved)) {
      const actual = await realpath(resolved);
      if (!isInside(actual, this.roots.output)) {
        throw new AppError("PATH_NOT_ALLOWED", "심볼릭 링크를 통한 output 폴더 이탈이 차단되었습니다.");
      }
    }
    if (createParent) await mkdir(path.dirname(resolved), { recursive: true });
    return resolved;
  }

  async inputImage(target: string, kinds?: RootKind[]): Promise<string> {
    const extension = path.extname(target).toLowerCase();
    if (!IMAGE_INPUT_EXTENSIONS.has(extension)) {
      throw new AppError("INVALID_EXTENSION", "입력 이미지는 JPG, JPEG, PNG, WEBP만 지원합니다.");
    }
    const actual = await this.readable(target, kinds);
    const info = await stat(actual);
    if (info.size > this.config.maxInputBytes) {
      throw new AppError("IMAGE_TOO_LARGE", `입력 파일이 허용 크기 ${this.config.maxInputBytes}바이트를 초과했습니다.`);
    }
    return actual;
  }

  async font(target: string): Promise<string> {
    const extension = path.extname(target).toLowerCase();
    if (![".ttf", ".otf", ".ttc", ".woff", ".woff2"].includes(extension)) {
      throw new AppError("FONT_NOT_FOUND", "지원되는 폰트 파일(TTF, OTF, TTC, WOFF, WOFF2)이 아닙니다.");
    }
    try {
      return await this.readable(target, ["assets"]);
    } catch {
      throw new AppError("FONT_NOT_FOUND", "폰트 파일이 없거나 assets 폴더 밖에 있습니다. assets 폴더에 한글 폰트를 배치하세요.");
    }
  }

  async exists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }
}
