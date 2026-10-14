import {
  type DocumentKind,
  MAX_UPLOAD_BYTES,
  UPLOAD_ERRORS,
  UploadRejectedError,
  type UploadRejection,
  uploadDocument,
} from "@pathwise/core/services/documents";
import { getJobQueue } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const KINDS: readonly string[] = ["cv", "linkedin", "other"] satisfies DocumentKind[];
const MULTIPART_OVERHEAD = 1024 * 1024;
const STATUS: Record<UploadRejection, number> = {
  too_large: 413,
  unsupported_type: 415,
  empty: 400,
  too_long: 400,
};

const reject = (reason: UploadRejection, status = STATUS[reason]) =>
  Response.json({ error: reason, message: UPLOAD_ERRORS[reason] }, { status });

export async function POST(req: Request) {
  const user = await requireApiSession(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Checked before the body is read. A body without a declared length is refused, not buffered.
  const length = Number(req.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0) {
    return Response.json({ error: "length_required" }, { status: 411 });
  }
  if (length > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) return reject("too_large");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || typeof kind !== "string" || !KINDS.includes(kind)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) return reject("too_large");

  const { db, config } = getServer();
  try {
    const doc = await uploadDocument({ db, config, queue: getJobQueue() }, user.userId, {
      filename: file.name,
      kind: kind as DocumentKind,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ id: doc.id }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) return reject(err.reason);
    throw err;
  }
}
