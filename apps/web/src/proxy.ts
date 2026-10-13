import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// These API routes authenticate themselves and return 401 rather than redirecting to sign-in.
// /api/documents also avoids proxy body buffering, which would truncate a max-size upload.
// Optimistic check only: pages still call requireSession() for the real session lookup.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const { pathname, search } = request.nextUrl;
    const target = new URL("/sign-in", request.url);
    // Return to the requested page after sign-in (e.g. the check-in email link); safeNext re-validates it.
    if (pathname !== "/") target.searchParams.set("next", pathname + search);
    return NextResponse.redirect(target);
  }
  const requestHeaders = new Headers(request.headers);
  // Overwrite any client value: only the proxy may choose the return path used by page/layout auth.
  requestHeaders.set("x-pathwise-return-to", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!sign-in|sign-up|forgot-password|reset-password|invite/|api/auth/|api/documents$|api/account/export$|api/health|_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
