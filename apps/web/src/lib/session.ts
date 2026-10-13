import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "./safe-next";
import { getServer, type Server } from "./server";

export type SessionUser = {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

type AuthSession = NonNullable<Awaited<ReturnType<Server["auth"]["api"]["getSession"]>>>;

const toSessionUser = ({ user }: AuthSession): SessionUser => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  role: user.role === "admin" ? "admin" : "user",
});

export async function requireSession(): Promise<SessionUser> {
  // headers() first: it opts the route into dynamic rendering before getServer() needs env/DB.
  const h = await headers();
  const session = await getServer().auth.api.getSession({ headers: h });
  if (!session) {
    const next = safeNext(h.get("x-pathwise-return-to"));
    redirect(next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`);
  }
  return toSessionUser(session);
}

/** For route handlers: the signed-in user, or null (the caller answers 401 instead of redirecting). */
export async function requireApiSession(req: Request): Promise<SessionUser | null> {
  const session = await getServer().auth.api.getSession({ headers: req.headers });
  return session ? toSessionUser(session) : null;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== "admin") redirect("/");
  return user;
}
