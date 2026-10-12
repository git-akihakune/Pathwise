import { checkHealth } from "@pathwise/core/health";
import { getServer } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (await checkHealth(getServer().db)) return Response.json({ status: "ok" });
  return Response.json({ status: "unavailable" }, { status: 503 });
}
