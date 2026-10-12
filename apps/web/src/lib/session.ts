import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServer } from "./server";

export type SessionUser = {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

export async function requireSession(): Promise<SessionUser> {
  // headers() first: it opts the route into dynamic rendering before getServer() needs env/DB.
  const h = await headers();
  const session = await getServer().auth.api.getSession({ headers: h });
  if (!session) redirect("/sign-in");
  const { user } = session;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== "admin") redirect("/");
  return user;
}
