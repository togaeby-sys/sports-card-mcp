import path from "node:path";
import { AppError } from "../errors.js";
import type { IssueType } from "../design/attention.js";
import type { Template } from "../pipeline.js";

export const CARD_ROLES = ["hook", "context", "evidence", "twist", "climax", "result", "reaction", "cta", "other"] as const;
export type CardRole = typeof CARD_ROLES[number];

export const LAYOUT_FAMILIES = [
  "number_shock",
  "player_stat",
  "quote_tension",
  "decision_climax",
  "clean_cta",
  "cinematic_hero",
] as const;
export type LayoutFamily = typeof LAYOUT_FAMILIES[number];

export interface SeriesPhotoInput {
  image_path: string;
  label?: string;
  preferred_roles?: CardRole[];
}

export interface SeriesCardInput {
  id?: string;
  role: CardRole;
  kicker?: string;
  headline: string;
  hero_number?: string;
  player_name?: string;
  jersey_number?: string;
  subheadline: string;
  english_tagline?: string;
  footer?: string;
  background_prompt?: string;
  include_player?: "auto" | "yes" | "no";
  photo_indices?: number[];
  layout_family?: LayoutFamily;
  poster_reference_path?: string;
  reuse_poster_path?: string;
  typography_verified?: boolean;
  seed?: number;
}

export interface CreateSeriesInput {
  series_id: string;
  output_dir: string;
  topic: string;
  issue_summary: string;
  issue_type?: IssueType;
  season?: string;
  league_label?: string;
  team_name?: string;
  team_color: string;
  accent_color?: string;
  template?: Template | "auto";
  render_provider?: "chatgpt_ui" | "gpt_app" | "manual_gpt_app" | "fal_api";
  photos: SeriesPhotoInput[];
  cards: SeriesCardInput[];
  retry_cards?: string[];
  dry_run?: boolean;
  force?: boolean;
}

export interface SubjectPlacement {
  x: number;
  y: number;
  height: number;
}

export interface DirectedCard extends SeriesCardInput {
  id: string;
  index: number;
  output_path: string;
  include_player: "yes" | "no";
  photo_indices: number[];
  layout_family: LayoutFamily;
  kicker: string;
  english_tagline: string;
  footer: string;
  background_prompt: string;
  typography_verified: boolean;
  visual_contract: {
    hero_text_source: "ai_cinematic_plate";
    local_text_scope: "microcopy_only";
    completion_gate: "technical_and_typography_review";
    subject_slots: number;
  };
}

export interface DirectedSeries {
  series_id: string;
  output_dir: string;
  cards: DirectedCard[];
  contract: {
    width: 1080;
    height: 1920;
    format: "png";
    original_player_pixels: true;
    generated_people_forbidden: true;
    large_local_typography_forbidden: true;
  };
}

const roleDefaults: Record<CardRole, { layout: LayoutFamily; players: 0 | 1; tagline: string }> = {
  hook: { layout: "number_shock", players: 0, tagline: "STOP THE SCROLL" },
  context: { layout: "player_stat", players: 1, tagline: "THE NUMBERS TELL THE STORY" },
  evidence: { layout: "player_stat", players: 1, tagline: "THE EVIDENCE" },
  twist: { layout: "quote_tension", players: 0, tagline: "EXPECTATION VS REALITY" },
  climax: { layout: "decision_climax", players: 1, tagline: "THE DECISION" },
  result: { layout: "cinematic_hero", players: 1, tagline: "THE RESULT" },
  reaction: { layout: "cinematic_hero", players: 1, tagline: "THE REACTION" },
  cta: { layout: "clean_cta", players: 0, tagline: "SAVE AND SHARE" },
  other: { layout: "cinematic_hero", players: 1, tagline: "KBO STORY" },
};

function safeId(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return normalized || fallback;
}

function choosePhoto(photos: SeriesPhotoInput[], role: CardRole, used: Set<number>): number | undefined {
  const preferred = photos.findIndex((photo, index) => !used.has(index) && photo.preferred_roles?.includes(role));
  if (preferred >= 0) return preferred;
  const unused = photos.findIndex((_photo, index) => !used.has(index));
  if (unused >= 0) return unused;
  return photos.length > 0 ? 0 : undefined;
}

function validatePhotoIndices(indices: number[], photoCount: number, cardId: string): number[] {
  const unique = [...new Set(indices)];
  if (unique.length > 2) throw new AppError("INVALID_ARGUMENT", `${cardId}: 한 카드에는 원본 선수 사진을 최대 2장까지 배치할 수 있습니다.`);
  for (const index of unique) {
    if (!Number.isInteger(index) || index < 0 || index >= photoCount) {
      throw new AppError("INVALID_ARGUMENT", `${cardId}: photo_indices에 존재하지 않는 사진 번호 ${index}가 포함되어 있습니다.`);
    }
  }
  return unique;
}

export function directSeries(input: CreateSeriesInput): DirectedSeries {
  if (!path.isAbsolute(input.output_dir)) throw new AppError("PATH_NOT_ABSOLUTE", "output_dir은 절대 경로여야 합니다.");
  if (input.cards.length < 1 || input.cards.length > 12) throw new AppError("INVALID_ARGUMENT", "시리즈 카드는 1장 이상 12장 이하여야 합니다.");
  const usedPhotos = new Set<number>();
  const usedIds = new Set<string>();
  const league = input.league_label?.trim() || "KBO";

  const cards = input.cards.map((card, index): DirectedCard => {
    const defaults = roleDefaults[card.role];
    const id = safeId(card.id ?? `${index + 1}-${card.role}`, `${index + 1}-${card.role}`);
    if (usedIds.has(id)) throw new AppError("INVALID_ARGUMENT", `중복된 카드 id입니다: ${id}`);
    usedIds.add(id);

    let photoIndices = validatePhotoIndices(card.photo_indices ?? [], input.photos.length, id);
    const requested = card.include_player ?? "auto";
    const shouldInclude = requested === "yes" || (requested === "auto" && defaults.players > 0 && input.photos.length > 0);
    if (requested === "no" && photoIndices.length > 0) throw new AppError("INVALID_ARGUMENT", `${id}: include_player=no인 카드에는 photo_indices를 지정할 수 없습니다.`);
    if (shouldInclude && photoIndices.length === 0) {
      const selected = choosePhoto(input.photos, card.role, usedPhotos);
      if (selected !== undefined) photoIndices = [selected];
    }
    if (requested === "yes" && photoIndices.length === 0) throw new AppError("INVALID_ARGUMENT", `${id}: 선수를 사용하도록 지정했지만 사용할 사진이 없습니다.`);
    if (!shouldInclude) photoIndices = [];
    photoIndices.forEach((photoIndex) => usedPhotos.add(photoIndex));

    const outputPath = path.join(input.output_dir, `${String(index + 1).padStart(2, "0")}-${id}.png`);
    const layoutFamily = card.layout_family ?? defaults.layout;
    const subjectSlots = photoIndices.length;
    return {
      ...card,
      id,
      index,
      output_path: outputPath,
      include_player: subjectSlots > 0 ? "yes" : "no",
      photo_indices: photoIndices,
      layout_family: layoutFamily,
      kicker: card.kicker?.trim() || `${input.season ? `${input.season} · ` : ""}${league} · ${card.role.toUpperCase()}`,
      english_tagline: card.english_tagline?.trim() || defaults.tagline,
      footer: card.footer?.trim() || [input.team_name, input.season, league].filter(Boolean).join(" · "),
      background_prompt: [input.topic, input.issue_summary, card.background_prompt].filter(Boolean).join(". "),
      typography_verified: card.typography_verified === true,
      visual_contract: {
        hero_text_source: "ai_cinematic_plate",
        local_text_scope: "microcopy_only",
        completion_gate: "technical_and_typography_review",
        subject_slots: subjectSlots,
      },
    };
  });

  for (const retryId of input.retry_cards ?? []) {
    if (!usedIds.has(retryId)) throw new AppError("INVALID_ARGUMENT", `retry_cards에 존재하지 않는 카드 id가 있습니다: ${retryId}`);
  }

  return {
    series_id: input.series_id,
    output_dir: input.output_dir,
    cards,
    contract: {
      width: 1080,
      height: 1920,
      format: "png",
      original_player_pixels: true,
      generated_people_forbidden: true,
      large_local_typography_forbidden: true,
    },
  };
}

export function layoutDirection(card: DirectedCard): string {
  const common = "premium Korean baseball blockbuster movie poster, dense depth, asymmetric perspective, metallic dimensional typography, black and team-color frames, sparks, stadium floodlights, cinematic contrast, never a presentation slide or dashboard";
  switch (card.layout_family) {
    case "number_shock":
      return `A single shocking numeral or statistic dominates 55 percent of the canvas, supporting headline tightly locked beneath it, no empty middle, abstract baseball evidence as the visual anchor; ${common}`;
    case "player_stat":
      return `Compressed stacked statistic headline in the upper 38 percent, one dramatic empty original-player slot from y=650 to y=1580, circular rim-light portal and layered stat frames; ${common}`;
    case "quote_tension":
      return `Large cinematic quote typography split across two angled levels, expectation above and present reality below, tunnel perspective and one decisive red reversal accent, no athlete slot; ${common}`;
    case "decision_climax":
      return `Urgent decision headline at the top, one oversized empty original-player slot occupying the lower 58 percent, converging dugout light and a hard diagonal choice motif; ${common}`;
    case "clean_cta":
      return `One bold save-worthy statement, premium central emblem shape, restrained but dimensional CTA plaque, stadium halo and generous deliberate negative space, no athlete slot; ${common}`;
    case "cinematic_hero":
      return `Monumental stacked title above one oversized empty original-player slot, explosive backlight and layered bottom plaques; ${common}`;
  }
}

export function subjectPlacement(card: DirectedCard, subjectIndex: number, subjectCount: number): SubjectPlacement {
  if (subjectCount === 2) {
    return {
      x: subjectIndex === 0 ? 345 : 745,
      y: 1190,
      height: card.role === "climax" ? 1110 : 1010,
    };
  }
  if (card.role === "context" || card.role === "evidence") return { x: 540, y: 1160, height: 1120 };
  if (card.role === "climax") return { x: 555, y: 1210, height: 1280 };
  return { x: 540, y: 1190, height: 1190 };
}
