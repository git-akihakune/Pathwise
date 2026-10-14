import { type Db, schema } from "../db";
import type { LlmPurpose, ModelRole } from "./types";

export async function recordUsage(
  db: Db,
  row: {
    userId: string;
    providerConfigId: string | null;
    model: string;
    role: ModelRole;
    purpose: LlmPurpose;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await db.insert(schema.llmUsage).values(row);
}
