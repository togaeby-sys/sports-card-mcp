import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { CardRecord, ExperimentRecord, InsightSnapshot, KnowledgeRule, LearningDatabase } from "./types.js";

const emptyDatabase = (): LearningDatabase => ({ version: 1, cards: [], insights: [], experiments: [], rules: [] });

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseDatabase(text: string): LearningDatabase {
  try {
    const parsed = JSON.parse(text) as Partial<LearningDatabase>;
    if (parsed.version !== 1 || !Array.isArray(parsed.cards) || !Array.isArray(parsed.insights) || !Array.isArray(parsed.experiments) || !Array.isArray(parsed.rules)) {
      throw new Error("지원되지 않는 지식 저장소 구조입니다.");
    }
    return parsed as LearningDatabase;
  } catch (error) {
    throw new AppError("LEARNING_STORE_ERROR", `카드 학습 저장소를 읽을 수 없습니다: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

export class LearningStore {
  private database: LearningDatabase = emptyDatabase();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: AppConfig) {
    if (!isInside(path.resolve(config.learningStorePath), path.resolve(config.outputDir))) {
      throw new AppError("PATH_NOT_ALLOWED", "학습 저장소는 output 폴더 안에 있어야 합니다.");
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.config.learningDir, { recursive: true });
    try {
      this.database = parseDatabase(await readFile(this.config.learningStorePath, "utf8"));
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.database = emptyDatabase();
      await this.persist();
    }
  }

  snapshot(): LearningDatabase {
    return structuredClone(this.database);
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.database, null, 2)}\n`;
    const tempPath = path.join(this.config.learningDir, `.knowledge-${process.pid}-${Date.now()}.tmp`);
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.config.learningStorePath);
    });
    try {
      await this.writeQueue;
    } catch (error) {
      throw new AppError("LEARNING_STORE_ERROR", `카드 학습 저장소를 저장하지 못했습니다: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  async upsertCard(record: CardRecord): Promise<CardRecord> {
    const index = this.database.cards.findIndex((item) => item.id === record.id);
    if (index >= 0) this.database.cards[index] = record;
    else this.database.cards.push(record);
    await this.persist();
    return structuredClone(record);
  }

  getCard(cardId: string): CardRecord {
    const record = this.database.cards.find((item) => item.id === cardId);
    if (!record) throw new AppError("LEARNING_RECORD_NOT_FOUND", `학습 카드 ID를 찾을 수 없습니다: ${cardId}`);
    return structuredClone(record);
  }

  listCards(): CardRecord[] {
    return structuredClone(this.database.cards);
  }

  async addInsight(snapshot: InsightSnapshot): Promise<InsightSnapshot> {
    const existing = this.database.insights.findIndex((item) => item.id === snapshot.id);
    if (existing >= 0) this.database.insights[existing] = snapshot;
    else this.database.insights.push(snapshot);
    await this.persist();
    return structuredClone(snapshot);
  }

  listInsights(): InsightSnapshot[] {
    return structuredClone(this.database.insights);
  }

  async upsertExperiment(experiment: ExperimentRecord): Promise<ExperimentRecord> {
    const index = this.database.experiments.findIndex((item) => item.id === experiment.id);
    if (index >= 0) this.database.experiments[index] = experiment;
    else this.database.experiments.push(experiment);
    await this.persist();
    return structuredClone(experiment);
  }

  async upsertRule(rule: KnowledgeRule): Promise<KnowledgeRule> {
    const index = this.database.rules.findIndex((item) => item.id === rule.id);
    if (index >= 0) this.database.rules[index] = rule;
    else this.database.rules.push(rule);
    await this.persist();
    return structuredClone(rule);
  }

  listRules(): KnowledgeRule[] {
    return structuredClone(this.database.rules);
  }
}
