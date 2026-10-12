function normalize(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** True when the browser's origin differs from the configured APP_URL (compared normalised). */
export function originMismatch(appUrl: string, origin: string): boolean {
  return normalize(appUrl) !== normalize(origin);
}
