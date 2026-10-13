import type { Db } from "../db";
import { NotFoundError } from "../errors";
import type { DeadLetterJob, DeadLetterRef, JobAdmin, QueueHealth } from "../jobs";
import { assertAdmin } from "./service";

export async function getJobHealth(
  db: Db,
  jobs: JobAdmin,
  actorId: string,
): Promise<{ queues: QueueHealth[]; deadLetters: DeadLetterJob[] }> {
  await assertAdmin(db, actorId);
  const [queues, deadLetters] = await Promise.all([jobs.queueHealth(), jobs.listDeadLetters()]);
  return { queues, deadLetters };
}

export async function retryDeadLetter(
  db: Db,
  jobs: JobAdmin,
  actorId: string,
  ref: DeadLetterRef,
): Promise<void> {
  await assertAdmin(db, actorId);
  if (!(await jobs.retryDeadLetter(ref))) {
    throw new NotFoundError("That job is no longer in the dead-letter queue.");
  }
}

export async function discardDeadLetter(
  db: Db,
  jobs: JobAdmin,
  actorId: string,
  ref: DeadLetterRef,
): Promise<void> {
  await assertAdmin(db, actorId);
  if (!(await jobs.discardDeadLetter(ref))) {
    throw new NotFoundError("That job is no longer in the dead-letter queue.");
  }
}
