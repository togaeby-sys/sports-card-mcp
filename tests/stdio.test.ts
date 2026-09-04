import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("stdio MCP startup", () => {
  it("answers initialize with MCP JSON on stdout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sports-card-stdio-"));
    const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
      cwd: path.resolve("."),
      env: { ...process.env, SPORTS_CARD_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const response = new Promise<string>((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(() => reject(new Error("MCP initialize response timeout")), 8_000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.includes("\n")) {
          clearTimeout(timer);
          resolve(stdout.split("\n")[0] ?? "");
        }
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (!stdout) reject(new Error(`server exited early: ${code}`));
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    const line = await response;
    child.kill("SIGTERM");
    const message = JSON.parse(line) as { jsonrpc: string; id: number; result: { serverInfo: { name: string } } };
    expect(message).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "sports-card-mcp" } } });
  });

  it("exposes the GPT app production workflow without analytics tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sports-card-tools-"));
    const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
      cwd: path.resolve("."),
      env: { ...process.env, SPORTS_CARD_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = new Promise<Array<{ name: string }>>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("MCP tools/list response timeout")), 8_000);
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        for (const line of buffer.split("\n").filter(Boolean)) {
          const message = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } };
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
          }
          if (message.id === 2 && message.result?.tools) {
            clearTimeout(timer);
            resolve(message.result.tools);
          }
        }
      });
      child.on("error", reject);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    const tools = await result;
    child.kill("SIGTERM");
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "create_reels_series",
      "setup_chatgpt_ui",
      "prepare_gpt_app_reels",
      "import_gpt_app_card",
      "get_gpt_app_reels_status",
      "finalize_gpt_app_reels",
    ]));
    expect(names).not.toEqual(expect.arrayContaining(["sync_instagram_insights", "analyze_card_performance", "register_published_card"]));
  });

  it("routes create_reels_series to GPT app planning by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sports-card-gpt-route-"));
    const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
      cwd: path.resolve("."),
      env: { ...process.env, SPORTS_CARD_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("MCP GPT route response timeout")), 8_000);
      child.stdout.on("data", (chunk) => {
        buffer += String(chunk);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const message = JSON.parse(line) as { id?: number; result?: { structuredContent?: Record<string, unknown> } };
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
            child.stdin.write(`${JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: {
                name: "create_reels_series",
                arguments: {
                  series_id: "stdio-gpt-default",
                  output_dir: path.join(root, "output", "stdio-gpt-default"),
                  topic: "충격 기록",
                  issue_summary: "숫자 훅",
                  team_color: "#F37321",
                  photos: [],
                  cards: [{ id: "hook", role: "hook", headline: "25실점", subheadline: "12이닝" }],
                  dry_run: true,
                },
              },
            })}\n`);
          }
          if (message.id === 2 && message.result?.structuredContent) {
            clearTimeout(timer);
            resolve(message.result.structuredContent);
          }
        }
      });
      child.on("error", reject);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    const response = await result;
    child.kill("SIGTERM");
    expect(response).toMatchObject({
      dry_run: true,
      status: "planned",
      render_provider: "chatgpt_ui",
      automatic_ui_generation: true,
      human_generation_step_required: false,
      estimated_gpt_app_generations: 1,
      estimated_calls: { fal_poster: 0 },
      player_images_sent_to_gpt_app: false,
      implicit_fal_fallback: false,
    });
  });
});
