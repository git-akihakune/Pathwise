import { toNextJsHandler } from "better-auth/next-js";
import { getServer } from "@/lib/server";

export const dynamic = "force-dynamic";

// Resolved per request so `next build` never needs config or a database.
export function GET(req: Request) {
  return toNextJsHandler(getServer().auth).GET(req);
}

export function POST(req: Request) {
  return toNextJsHandler(getServer().auth).POST(req);
}
