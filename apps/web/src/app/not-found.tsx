import Link from "next/link";
import { Brand } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 p-6">
      <Brand />
      <EmptyState
        title="This page isn't here"
        description="It may have moved or no longer exist. Return to your workspace to continue."
        action={
          <Link href="/" className={buttonVariants()}>
            Back to Today
          </Link>
        }
      />
    </main>
  );
}
