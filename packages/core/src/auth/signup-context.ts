import { AsyncLocalStorage } from "node:async_hooks";

export interface SignupContext {
  inviteToken?: string;
  inviteId?: string;
}

// Held on globalThis: bundlers (Next.js) can instantiate this module once per layer, and the
// context set by sign-up must be visible to the hook inside the auth instance built elsewhere.
const g = globalThis as typeof globalThis & {
  __pathwiseSignupStorage?: AsyncLocalStorage<SignupContext>;
};
g.__pathwiseSignupStorage ??= new AsyncLocalStorage<SignupContext>();
const storage = g.__pathwiseSignupStorage;

export function runInSignupContext<T>(ctx: SignupContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getSignupContext(): SignupContext | undefined {
  return storage.getStore();
}
