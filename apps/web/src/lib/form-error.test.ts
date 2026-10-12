import { ForbiddenError, NotFoundError, ValidationError } from "@pathwise/core/errors";
import { describe, expect, it, vi } from "vitest";
import { toFormError } from "./form-error";

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

  it("hides the message of anything else", () => {
    expect(toFormError(new Error("secret sk-123 leaked"), { configId: "c1" })).toEqual({
      error: "Something went wrong. Check the server logs.",
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });
});
