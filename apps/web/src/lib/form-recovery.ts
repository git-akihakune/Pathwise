import { unstable_rethrow } from "next/navigation";

type ActionState = { error?: string } | undefined;

export function recoverFormAction<State extends ActionState>(
  action: (previous: State, data: FormData) => Promise<State>,
): (previous: State, data: FormData) => Promise<State> {
  return async (previous, data) => {
    try {
      return await action(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      // Every application action state permits a form-level error; never expose a raw exception.
      return {
        error:
          "Couldn't confirm this action. Check your connection and review the current data before trying again.",
      } as State;
    }
  };
}
