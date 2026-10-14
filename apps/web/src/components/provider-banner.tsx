import type { getProviderStatusForUser } from "@pathwise/core/services/providers";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Status = Awaited<ReturnType<typeof getProviderStatusForUser>>;

export function ProviderBanner({ status, isAdmin }: { status: Status; isAdmin: boolean }) {
  let title: string;
  let link: { href: string; text: string } | null;
  if (status.authFailed && status.source === "user") {
    title = "Your API key was rejected.";
    link = { href: "/settings", text: "Update it in Settings" };
  } else if (status.authFailed && status.source === "instance") {
    title = "The instance's AI provider key was rejected. Ask your admin to update it.";
    link = isAdmin ? { href: "/admin", text: "Open Admin" } : null;
  } else if (
    status.source === "none" ||
    status.status === "untested" ||
    status.status === "unsupported"
  ) {
    title = "Connect an AI provider to use the coach";
    link = { href: "/settings", text: "Open Settings" };
  } else {
    return null;
  }
  return (
    <div className="mx-auto w-full max-w-[76rem] px-5 pt-6 sm:px-8 lg:px-10">
      <Alert>
        <AlertTitle>{title}</AlertTitle>
        {link && (
          <AlertDescription>
            <Link href={link.href} className="font-medium underline underline-offset-4">
              {link.text}
            </Link>
          </AlertDescription>
        )}
      </Alert>
    </div>
  );
}
