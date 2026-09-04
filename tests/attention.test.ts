import { describe, expect, it } from "vitest";
import { resolveAttentionStrategy } from "../src/design/attention.js";
import { createSchema } from "../src/schemas.js";

describe("attention strategy", () => {
  it.each([
    ["walk_off", "cinematic_red", "dense", "WALK-OFF"],
    ["championship", "championship_gold", "dense", "CHAMPIONS"],
    ["record", "championship_gold", "dense", "NEW RECORD"],
    ["transfer", "breaking_news", "dense", "TRANSFER"],
    ["schedule", "night_stadium", "balanced", "GAME DAY"],
  ] as const)("maps %s to a high-attention visual direction", (issue, template, density, label) => {
    const result = resolveAttentionStrategy({
      template: "auto",
      issue_type: issue,
      team_color: "#7A0019",
      season: "2026 시즌",
      league_label: "KBO",
      headline: "테스트",
      score_text: "",
    });
    expect(result).toMatchObject({ template, density, issue_label: label });
    expect(result.kicker).toContain("2026 시즌");
    expect(result.background_direction.length).toBeGreaterThan(20);
  });

  it("uses the jersey number as a locally rendered hero element", () => {
    const result = resolveAttentionStrategy({
      template: "auto",
      issue_type: "grand_slam",
      team_color: "#7A0019",
      player_name: "김재현",
      jersey_number: "22",
      headline: "끝내기 만루홈런",
      score_text: "",
    });
    expect(result.hero_text).toBe("22");
    expect(result.intensity).toBe(9);
    expect(result.headline_preset).toBe("impact_gold");
  });

  it("preserves an explicit template while retaining issue art direction", () => {
    const result = resolveAttentionStrategy({
      template: "night_stadium",
      issue_type: "contract",
      team_color: "#13294B",
      headline: "FA 계약",
      score_text: "100억",
    });
    expect(result.template).toBe("night_stadium");
    expect(result.issue_label).toBe("CONTRACT");
    expect(result.background_direction).toContain("contract");
  });
});

describe("create_sports_card schema", () => {
  it("applies smart defaults so callers do not need to hand-place every element", () => {
    const result = createSchema.parse({
      player_image: "/allowed/input/player.jpg",
      output_path: "/allowed/output/card.png",
      team_color: "#7A0019",
      headline: "끝내기 만루홈런",
    });
    expect(result.template).toBe("auto");
    expect(result.issue_type).toBe("generic");
    expect(result.poster_style).toBe("auto");
    expect(result.player_position).toBeUndefined();
    expect(result.text_safe_area).toEqual({ x: 60, y: 50, width: 960, height: 1810 });
  });

  it("rejects unsafe color strings before they reach SVG rendering", () => {
    expect(() => createSchema.parse({
      player_image: "/allowed/input/player.jpg",
      output_path: "/allowed/output/card.png",
      team_color: "red\"/><script>",
      headline: "잘못된 색상",
    })).toThrow();
  });
});
