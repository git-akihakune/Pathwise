"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  advanceAction,
  attachUploadAction,
  type OnboardingFormState,
  pasteTextAction,
} from "./actions";

/** The upload route's JSON body is `{ id }` on success and `{ message }` for a refused file. */
async function upload(file: File, kind: string): Promise<{ id: string } | { error: string }> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);
  const res = await fetch("/api/documents", { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (res.ok && json.id) return { id: json.id };
  return { error: json.message ?? "The upload failed. Try again, or paste the text instead." };
}

export function IngestStep({
  runId,
  stepId,
  pending,
  failure,
}: {
  runId: string;
  stepId: string;
  pending: boolean;
  /** Copy for a document that could not be read. */
  failure: string | null;
}) {
  const [kind, setKind] = useState("cv");
  const [uploadError, setUploadError] = useState<string>();
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, paste, pasting] = useActionState<OnboardingFormState, FormData>(
    pasteTextAction,
    undefined,
  );

  const submitUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose a file first.");
      return;
    }
    startUpload(async () => {
      const r = await upload(file, kind);
      if ("error" in r) return setUploadError(r.error);
      const attached = await attachUploadAction(runId, r.id);
      setUploadError(attached?.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Add your CV or LinkedIn profile</h2>
      <p>
        Upload a PDF, Word or text file (up to 10 MB), or paste the text. We'll pull out your
        experience so you don't have to type it.
      </p>
      {pending && <p>Reading your document…</p>}
      {failure && <Alert variant="destructive">{failure}</Alert>}
      <div className="flex flex-col items-start gap-1">
        <Label htmlFor="document-kind">This is my</Label>
        <select
          id="document-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="h-9 w-48 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="cv">CV</option>
          <option value="linkedin">LinkedIn profile</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex-col items-start gap-1">
          File
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="text-sm" />
        </Label>
        {uploadError && <Alert variant="destructive">{uploadError}</Alert>}
        <div>
          <Button type="button" disabled={uploading || pending} onClick={submitUpload}>
            Upload
          </Button>
        </div>
      </div>
      <form action={paste} className="flex flex-col gap-2">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="kind" value={kind} />
        <Label className="flex-col items-start gap-1">
          Or paste text
          <Textarea name="text" rows={6} maxLength={100000} />
        </Label>
        {pasted?.error && <Alert variant="destructive">{pasted.error}</Alert>}
        <div>
          <Button type="submit" variant="outline" disabled={pasting || pending}>
            Use this text
          </Button>
        </div>
      </form>
      <form action={advanceAction}>
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="stepId" value={stepId} />
        <input type="hidden" name="skip" value="1" />
        <Button type="submit" variant="ghost">
          Skip this step
        </Button>
      </form>
    </div>
  );
}
