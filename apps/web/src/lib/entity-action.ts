import { NotFoundError } from "@pathwise/core/errors";
import { revalidatePath } from "next/cache";
import { GONE_MESSAGE, toFormError } from "@/lib/form-error";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string } | undefined;

/** An empty field means "no value": null clears a stored field on update. */
export const field = (fd: FormData, name: string): string | null => {
  const v = fd.get(name);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const version = (fd: FormData) => {
  const v = field(fd, "version");
  return v === null ? undefined : Number(v);
};

/** Runs a save: creates, or updates when the form carries a hidden id. */
export async function saveEntity(
  path: string,
  fd: FormData,
  create: (userId: string) => Promise<unknown>,
  update: (userId: string, id: string, expectedVersion?: number) => Promise<unknown>,
): Promise<FormState> {
  const { userId } = await requireSession();
  const id = field(fd, "id");
  try {
    await (id ? update(userId, id, version(fd)) : create(userId));
  } catch (e) {
    return e instanceof NotFoundError ? { error: GONE_MESSAGE } : toFormError(e);
  }
  revalidatePath(path);
}

/** Deleting something already gone is a success. */
export async function removeEntity(
  path: string,
  fd: FormData,
  del: (userId: string, id: string) => Promise<void>,
) {
  const { userId } = await requireSession();
  try {
    await del(userId, field(fd, "id") ?? "");
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath(path);
}
