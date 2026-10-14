/** Post-sign-in redirect target: same-origin relative paths only (open-redirect safe). */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length > 2000) return "/";
  // Decode once more so %2f%2fevil.com and %5c variants can't slip past a later decoding hop.
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/";
  }
  for (const candidate of [next, decoded]) {
    if (!/^\/(?![/\\])/.test(candidate)) return "/";
    if (/^\/(sign-in|sign-up)/.test(candidate)) return "/";
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject control chars (tab/newline are stripped by URL parsers)
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return "/";
  }
  return next;
}
