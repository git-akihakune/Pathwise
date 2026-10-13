import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <span className="font-semibold">Pathwise</span>
        <Link href="/" className="text-sm">
          Today
        </Link>
        <Link href="/coach" className="text-sm">
          Coach
        </Link>
        <Link href="/plan" className="text-sm">
          Plan
        </Link>
        <Link href="/profile" className="text-sm">
          Profile
        </Link>
        <Link href="/stories" className="text-sm">
          Stories
        </Link>
        <Link href="/settings" className="text-sm">
          Settings
        </Link>
        {isAdmin && (
          <Link href="/admin" className="text-sm">
            Admin
          </Link>
        )}
        <form action={signOutAction} className="ml-auto">
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </nav>
    </header>
  );
}
