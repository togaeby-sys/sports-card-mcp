import { symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { PathGuard } from "../src/security/paths.js";
import { testConfig } from "./helpers.js";

describe("PathGuard", () => {
  it("requires absolute paths and blocks files outside allowed roots", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    await expect(guard.readable("relative.png")).rejects.toMatchObject({ code: "PATH_NOT_ABSOLUTE" });
    const outside = path.join(config.rootDir, "outside.png");
    await writeFile(outside, "x");
    await expect(guard.readable(outside)).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  it("blocks symlink escapes and invalid input extensions", async () => {
    const config = await testConfig();
    const guard = new PathGuard(config);
    await guard.initialize();
    const outside = path.join(config.rootDir, "secret.png");
    await writeFile(outside, "x");
    const link = path.join(config.inputDir, "link.png");
    await symlink(outside, link);
    await expect(guard.readable(link)).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    const text = path.join(config.inputDir, "file.gif");
    await writeFile(text, "x");
    await expect(guard.inputImage(text)).rejects.toBeInstanceOf(AppError);
    await expect(guard.inputImage(text)).rejects.toMatchObject({ code: "INVALID_EXTENSION" });
  });
});
