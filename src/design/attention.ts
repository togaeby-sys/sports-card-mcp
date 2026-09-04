import type { Template } from "../pipeline.js";

export const ISSUE_TYPES = [
  "generic",
  "walk_off",
  "grand_slam",
  "home_run",
  "victory",
  "championship",
  "record",
  "milestone",
  "award",
  "all_star",
  "transfer",
  "contract",
  "breaking_news",
  "rivalry",
  "schedule",
] as const;

export type IssueType = typeof ISSUE_TYPES[number];
export type LayoutDensity = "balanced" | "dense" | "maximum";

export interface AttentionInput {
  template: Template | "auto";
  issue_type: IssueType;
  team_color: string;
  secondary_color?: string;
  accent_color?: string;
  season?: string;
  league_label?: string;
  team_name?: string;
  player_name?: string;
  jersey_number?: string;
  headline: string;
  score_text: string;
  visual_intensity?: number;
  layout_density?: LayoutDensity;
}

export interface AttentionStrategy {
  template: Template;
  issue_type: IssueType;
  issue_label: string;
  kicker: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_color: string;
  headline_preset: "impact_white" | "impact_gold" | "impact_orange";
  intensity: number;
  density: LayoutDensity;
  hero_text?: string;
  background_direction: string;
  player_position: { x: number; y: number; scale: number; rotation: number; anchor: "center" };
}

interface IssueRule {
  template: Template;
  label: string;
  intensity: number;
  density: LayoutDensity;
  preset: AttentionStrategy["headline_preset"];
  direction: string;
}

const rules: Record<IssueType, IssueRule> = {
  generic: { template: "night_stadium", label: "KBO STORY", intensity: 7, density: "dense", preset: "impact_white", direction: "premium editorial baseball poster with directional stadium lights" },
  walk_off: { template: "cinematic_red", label: "WALK-OFF", intensity: 9, density: "dense", preset: "impact_gold", direction: "last-play explosion localized behind the player, victory sparks, strong black negative space and a focused radial energy burst" },
  grand_slam: { template: "cinematic_red", label: "GRAND SLAM", intensity: 9, density: "dense", preset: "impact_gold", direction: "four-run grand-slam energy localized around home plate, controlled fire columns, sparks, deep black negative space and triumphant stadium scale" },
  home_run: { template: "cinematic_red", label: "HOME RUN", intensity: 8, density: "dense", preset: "impact_gold", direction: "towering home-run moment, one focused fire trail, hard rim lights, sparse flying sparks and large clean editorial text zones" },
  victory: { template: "night_stadium", label: "FINAL", intensity: 8, density: "dense", preset: "impact_white", direction: "winning night atmosphere, scoreboard glow, confetti sparks and strong team-color beams" },
  championship: { template: "championship_gold", label: "CHAMPIONS", intensity: 9, density: "dense", preset: "impact_gold", direction: "championship ceremony, focused golden confetti, trophy-like light rays, deep shadows and majestic stadium scale" },
  record: { template: "championship_gold", label: "NEW RECORD", intensity: 8, density: "dense", preset: "impact_gold", direction: "historic record celebration, premium black-and-gold lighting and monumental number-focused composition" },
  milestone: { template: "championship_gold", label: "MILESTONE", intensity: 8, density: "dense", preset: "impact_gold", direction: "career milestone tribute, elegant gold spotlights, subtle particles and archival prestige" },
  award: { template: "certificate", label: "AWARD", intensity: 6, density: "balanced", preset: "impact_gold", direction: "formal award presentation, restrained gold light, premium ceremonial stadium and elegant depth" },
  all_star: { template: "championship_gold", label: "ALL-STAR", intensity: 8, density: "dense", preset: "impact_gold", direction: "all-star showcase, star-shaped light rays, gold and team-color spotlights and celebratory particles" },
  transfer: { template: "breaking_news", label: "TRANSFER", intensity: 8, density: "dense", preset: "impact_orange", direction: "urgent roster move announcement, broadcast newsroom energy, controlled diagonal streaks and stadium tunnel lights" },
  contract: { template: "breaking_news", label: "CONTRACT", intensity: 8, density: "dense", preset: "impact_orange", direction: "major contract announcement, premium broadcast graphics mood, restrained diagonal lights and financial-news urgency" },
  breaking_news: { template: "breaking_news", label: "BREAKING", intensity: 9, density: "dense", preset: "impact_white", direction: "urgent breaking sports news, localized red alert lighting, fast diagonal energy and broadcast-ready negative space" },
  rivalry: { template: "cinematic_red", label: "RIVALRY", intensity: 9, density: "dense", preset: "impact_white", direction: "high-tension rivalry game, opposing light banks, smoke, sparks and dramatic center-line contrast" },
  schedule: { template: "night_stadium", label: "GAME DAY", intensity: 5, density: "balanced", preset: "impact_white", direction: "clean game-day stadium, clear information zones, crisp floodlights and restrained particles" },
};

function normalizeHex(color: string): string {
  const raw = color.trim();
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw.slice(1).split("").map((part) => `${part}${part}`).join("")}`.toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  return "#8B1E2D";
}

function channel(color: string, offset: number): number {
  return Number.parseInt(color.slice(offset, offset + 2), 16);
}

function mix(color: string, target: "black" | "white", amount: number): string {
  const normalized = normalizeHex(color);
  const destination = target === "white" ? 255 : 0;
  const next = [1, 3, 5].map((offset) => Math.round(channel(normalized, offset) * (1 - amount) + destination * amount));
  return `#${next.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function luminance(color: string): number {
  const normalized = normalizeHex(color);
  const r = channel(normalized, 1) / 255;
  const g = channel(normalized, 3) / 255;
  const b = channel(normalized, 5) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function compact(parts: Array<string | undefined>): string[] {
  return parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
}

export function resolveAttentionStrategy(input: AttentionInput): AttentionStrategy {
  const rule = rules[input.issue_type];
  const template = input.template === "auto" ? rule.template : input.template;
  const primary = normalizeHex(input.team_color);
  const secondary = normalizeHex(input.secondary_color ?? mix(primary, "black", 0.58));
  const defaultAccent = rule.preset === "impact_gold" ? "#FFB21C" : rule.preset === "impact_orange" ? "#FF6A00" : mix(primary, "white", 0.42);
  const accent = normalizeHex(input.accent_color ?? defaultAccent);
  const kicker = compact([input.season, input.league_label ?? "KBO", rule.label]).join(" · ");
  const intensity = Math.max(0, Math.min(10, input.visual_intensity ?? rule.intensity));
  const heroCandidate = input.jersey_number?.trim();
  const backgroundContext = compact([input.team_name, input.season, input.player_name]).join(", ");
  return {
    template,
    issue_type: input.issue_type,
    issue_label: rule.label,
    kicker,
    primary_color: primary,
    secondary_color: secondary,
    accent_color: accent,
    text_color: luminance(primary) > 0.66 ? "#090A0D" : "#FFFFFF",
    headline_preset: rule.preset,
    intensity,
    density: input.layout_density ?? rule.density,
    ...(heroCandidate ? { hero_text: heroCandidate } : {}),
    background_direction: `${rule.direction}, premium Korean sports editorial art direction, high contrast but restrained palette, no text, no letters, no numbers, no athlete, no person, no team logo${backgroundContext ? `, contextual cues: ${backgroundContext}` : ""}`,
    player_position: {
      x: input.issue_type === "schedule" || input.issue_type === "award" ? 610 : 675,
      y: input.issue_type === "championship" ? 1160 : 1190,
      scale: input.layout_density === "balanced" ? 1.08 : 1.22,
      rotation: 0,
      anchor: "center",
    },
  };
}
