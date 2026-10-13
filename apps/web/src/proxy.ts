import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// /api/documents authenticates itself: the proxy buffers bodies only up to 10 MB, which would truncate a max-size upload.
// Optimistic check only: pages still call requireSession() for the real session lookup.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!sign-in|sign-up|invite/|api/auth/|api/documents|api/health|_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
