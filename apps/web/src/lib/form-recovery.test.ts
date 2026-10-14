import { describe, expect, it } from "vitest";
import { recoverFormAction } from "./form-recovery";

describe("form action recovery", () => {
  it("preserves confirmed action results and field data", async () => {
    const data = new FormData();
    data.set("title", "My draft");
    const saved = { saved: true };
    const action = recoverFormAction(
      async (_previous: { saved?: boolean; error?: string } | undefined, form: FormData) => {
        expect(form.get("title")).toBe("My draft");
        return saved;
      },
    );
    expect(await action(undefined, data)).toBe(saved);
  });

  it("preserves domain validation errors", async () => {
    const validation = { error: "Use YYYY, YYYY-MM or YYYY-MM-DD." };
    const action = recoverFormAction<{ error?: string } | undefined>(async () => validation);
    expect(await action(undefined, new FormData())).toBe(validation);
  });

  it("turns transport failures into recoverable feedback without exposing raw errors", async () => {
    const action = recoverFormAction<{ error?: string } | undefined>(async () => {
      throw new Error("private server detail");
    });
    expect(await action(undefined, new FormData())).toEqual({
      error:
        "Couldn't confirm this action. Check your connection and review the current data before trying again.",
    });
  });
});

it("lets Next.js handle successful action redirects", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;push;/stories;307;",
  });
  const action = recoverFormAction<{ error?: string } | undefined>(async () => {
    throw redirect;
  });
  await expect(action(undefined, new FormData())).rejects.toBe(redirect);
});
