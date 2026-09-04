import path from "node:path";
import { describe, expect, it } from "vitest";
import { directSeries } from "../src/series/director.js";
import { createSeriesSchema } from "../src/schemas.js";

describe("reels series director", () => {
  it("defaults the public reels provider to the GPT app workflow", () => {
    const parsed = createSeriesSchema.parse({
      series_id: "provider-default",
      output_dir: "/allowed/output/provider-default",
      topic: "test",
      issue_summary: "test",
      team_color: "#F37321",
      photos: [],
      cards: [{ role: "hook", headline: "25실점", subheadline: "12이닝" }],
    });
    expect(parsed.render_provider).toBe("chatgpt_ui");
  });

  it("assigns photos by narrative role instead of forcing one player on every card", () => {
    const directed = directSeries({
      series_id: "zimmermann-story",
      output_dir: "/allowed/output/zimmermann-story",
      topic: "12이닝 25실점",
      issue_summary: "기대와 현실의 충돌",
      team_color: "#F37321",
      photos: [
        { image_path: "/allowed/input/one.jpg", preferred_roles: ["context"] },
        { image_path: "/allowed/input/two.jpg", preferred_roles: ["climax"] },
      ],
      cards: [
        { role: "hook", headline: "25실점", subheadline: "12이닝 만에" },
        { role: "context", headline: "12이닝 · 25실점", subheadline: "기대를 안고 왔던 투수" },
        { role: "twist", headline: "로테이션을 바꿀 투수", subheadline: "지금은 불펜 강등 위기" },
        { role: "climax", headline: "한화의 선택", subheadline: "결단이 필요한 순간" },
        { role: "cta", headline: "한화 팬이라면", subheadline: "저장해둘 이야기" },
      ],
    });
    expect(directed.cards.map((card) => card.photo_indices)).toEqual([[], [0], [], [1], []]);
    expect(directed.cards.map((card) => card.layout_family)).toEqual(["number_shock", "player_stat", "quote_tension", "decision_climax", "clean_cta"]);
    expect(directed.cards.every((card) => card.visual_contract.hero_text_source === "ai_cinematic_plate")).toBe(true);
    expect(directed.cards.every((card) => path.isAbsolute(card.output_path))).toBe(true);
  });

  it("requires an available source photo when player use is explicit", () => {
    expect(() => directSeries({
      series_id: "missing-photo",
      output_dir: "/allowed/output/missing-photo",
      topic: "test",
      issue_summary: "test",
      team_color: "#F37321",
      photos: [],
      cards: [{ role: "climax", headline: "결정", subheadline: "순간", include_player: "yes" }],
    })).toThrow(/사용할 사진이 없습니다/);
  });
});
