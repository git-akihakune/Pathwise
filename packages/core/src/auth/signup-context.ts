import { AsyncLocalStorage } from "node:async_hooks";

export interface SignupContext {
  inviteToken?: string;
  inviteId?: string;
}

const storage = new AsyncLocalStorage<SignupContext>();

export function runInSignupContext<T>(ctx: SignupContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function getSignupContext(): SignupContext | undefined {
  return storage.getStore();
}
