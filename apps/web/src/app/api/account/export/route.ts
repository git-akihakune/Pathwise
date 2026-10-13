import { exportUserData } from "@pathwise/core/services/account";
import { headers } from "next/headers";
import { getServer } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const { auth, db, config } = getServer();
  const session = await auth.api.getSession({ headers: h });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const bytes = await exportUserData(db, session.user.id, { filesDir: config.filesDir, now });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="pathwise-export-${now.toISOString().slice(0, 10)}.zip"`,
      "cache-control": "no-store",
    },
  });
}
