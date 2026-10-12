"use server";

import { ConflictError, NotFoundError } from "@pathwise/core/errors";
import {
  addMemory,
  deleteMemory,
  type MemoryCategory,
  setMemoryStatus,
  updateMemory,
} from "@pathwise/core/services/memory";
import {
  createEducation,
  createExperience,
  createSkill,
  deleteEducation,
  deleteExperience,
  deleteSkill,
  type SkillLevel,
  updateEducation,
  updateExperience,
  updateSkill,
} from "@pathwise/core/services/profile";
import { searchTaxonomySkills } from "@pathwise/core/taxonomy";
import { revalidatePath } from "next/cache";
import { type FormState, field, removeEntity, saveEntity } from "@/lib/entity-action";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

const save = (
  fd: FormData,
  create: (userId: string) => Promise<unknown>,
  update: (userId: string, id: string, expectedVersion?: number) => Promise<unknown>,
) => saveEntity("/profile", fd, create, update);
const remove = (fd: FormData, del: (userId: string, id: string) => Promise<void>) =>
  removeEntity("/profile", fd, del);

const experienceFields = (fd: FormData) => ({
  title: field(fd, "title") ?? "",
  organization: field(fd, "organization"),
  startDate: field(fd, "startDate"),
  endDate: field(fd, "endDate"),
  description: field(fd, "description"),
  highlights: (field(fd, "highlights") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
});

export async function saveExperienceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const values = experienceFields(fd);
  return save(
    fd,
    (userId) => createExperience(db, userId, values),
    (userId, id, v) => updateExperience(db, userId, id, values, v),
  );
}

export async function deleteExperienceAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await remove(fd, (userId, id) => deleteExperience(db, userId, id));
}

const educationFields = (fd: FormData) => ({
  institution: field(fd, "institution") ?? "",
  qualification: field(fd, "qualification"),
  field: field(fd, "field"),
  startDate: field(fd, "startDate"),
  endDate: field(fd, "endDate"),
});

export async function saveEducationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const values = educationFields(fd);
  return save(
    fd,
    (userId) => createEducation(db, userId, values),
    (userId, id, v) => updateEducation(db, userId, id, values, v),
  );
}

export async function deleteEducationAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await remove(fd, (userId, id) => deleteEducation(db, userId, id));
}

export async function saveSkillAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const values = {
    name: field(fd, "name") ?? "",
    level: field(fd, "level") as SkillLevel | null,
    evidence: field(fd, "evidence"),
    // Absent: the server links an exact name match itself.
    taxonomySkillId: field(fd, "taxonomySkillId") ?? undefined,
  };
  return save(
    fd,
    (userId) => createSkill(db, userId, values),
    (userId, id, v) => updateSkill(db, userId, id, values, v),
  );
}

export async function deleteSkillAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await remove(fd, (userId, id) => deleteSkill(db, userId, id));
}

export async function searchSkillsAction(
  query: string,
): Promise<{ id: string; name: string; source: "onet" | "esco" }[]> {
  await requireSession();
  return searchTaxonomySkills(getServer().db, query, 8);
}

export async function saveMemoryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db } = getServer();
  const category = field(fd, "category") as MemoryCategory;
  const content = field(fd, "content") ?? "";
  return save(
    fd,
    (userId) =>
      addMemory(db, userId, {
        category,
        content,
        sourceType: "manual",
        sourceId: null,
        confidence: 1,
        sensitive: false,
        status: "active",
      }),
    (userId, id, v) => updateMemory(db, userId, id, { category, content }, v),
  );
}

export async function deleteMemoryAction(fd: FormData): Promise<void> {
  const { db } = getServer();
  await remove(fd, (userId, id) => deleteMemory(db, userId, id));
}

export async function setMemoryStatusAction(
  id: string,
  status: "active" | "rejected",
): Promise<void> {
  const { userId } = await requireSession();
  try {
    await setMemoryStatus(getServer().db, userId, id, status);
  } catch (e) {
    // Already confirmed or dismissed elsewhere: the refreshed list shows the truth.
    if (!(e instanceof NotFoundError || e instanceof ConflictError)) throw e;
  }
  revalidatePath("/profile");
}
