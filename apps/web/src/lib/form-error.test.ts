import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@pathwise/core/errors";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CONFLICT_MESSAGE, GONE_MESSAGE, toFormError } from "./form-error";

const logged = vi.hoisted(() => vi.fn());
vi.mock("@pathwise/core/logger", () => ({ createLogger: () => ({ error: logged }) }));

describe("toFormError", () => {
  it("passes through the messages of user-facing core errors", () => {
    expect(toFormError(new ValidationError("Bad label."))).toEqual({ error: "Bad label." });
    expect(toFormError(new ForbiddenError("Nope."))).toEqual({ error: "Nope." });
    expect(toFormError(new NotFoundError("Provider not found"))).toEqual({
      error: "Provider not found",
    });
  });

  it("maps validation and conflict errors to user copy", () => {
    const zod = z
      .object({ title: z.string().min(1, "Enter a title.") })
      .safeParse({ title: "" }).error;
    expect(toFormError(zod)).toEqual({ error: "Enter a title." });
    expect(toFormError(new ConflictError("x"))).toEqual({ error: CONFLICT_MESSAGE });
    expect(GONE_MESSAGE).toBe("This item no longer exists. Reload the page.");
  });

  it("hides the message of anything else", () => {
    expect(toFormError(new Error("secret sk-123 leaked"), { configId: "c1" })).toEqual({
      error: "Something went wrong. Check the server logs.",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });
});
