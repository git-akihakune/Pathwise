import { z } from "zod";
import { parseDocument } from "../services/documents";
import { JOBS } from "./queue";
import type { JobDefinition } from "./register";

/** Standard policy, on purpose: ensureQueues recreates a queue whose policy changes, dropping pending parses. */
export const documentParseJob: JobDefinition<{ userId: string; documentId: string }> = {
  name: JOBS.documentParse,
  schema: z.object({ userId: z.string(), documentId: z.uuid() }),
  handler: parseDocument,
};
