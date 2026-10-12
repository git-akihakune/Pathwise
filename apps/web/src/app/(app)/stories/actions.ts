"use server";

import { createStory, deleteStory, updateStory } from "@pathwise/core/services/stories";
import { redirect } from "next/navigation";
import { type FormState, field, removeEntity, saveEntity } from "@/lib/entity-action";
import { getServer } from "@/lib/server";

export async function saveStoryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const values = {
    title: field(fd, "title") ?? "",
    situation: field(fd, "situation") ?? "",
    task: field(fd, "task") ?? "",
    action: field(fd, "action") ?? "",
    result: field(fd, "result") ?? "",
    metrics: field(fd, "metrics"),
    skills: (field(fd, "skills") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const result = await saveEntity(
    "/stories",
    fd,
    (userId) => createStory(db, userId, values),
    (userId, id, v) => updateStory(db, userId, id, values, v),
  );
  if (!result?.error) redirect("/stories");
  return result;
}

export async function deleteStoryAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await removeEntity("/stories", fd, (userId, id) => deleteStory(db, userId, id));
}
