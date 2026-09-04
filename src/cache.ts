import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import type { PathGuard } from "./security/paths.js";

export class FileCache {
  constructor(private readonly config: AppConfig, private readonly guard: PathGuard) {}

  playerPath(key: string): string {
    return path.join(this.config.cacheDir, "players", `${key}.png`);
  }

  backgroundPath(key: string): string {
    return path.join(this.config.cacheDir, "backgrounds", `${key}.png`);
  }

  async has(filePath: string): Promise<boolean> {
    return this.guard.exists(filePath);
  }

  async put(source: string, cachePath: string): Promise<void> {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await copyFile(source, cachePath);
  }

  async restore(cachePath: string, outputPath: string): Promise<void> {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(cachePath, outputPath);
  }
}
