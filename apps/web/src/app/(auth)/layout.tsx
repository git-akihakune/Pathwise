import { Check, Compass } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { CareerJourney } from "@/components/career-journey";
import { ThemeSelect } from "@/components/theme-select";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex xl:p-16">
        <Link href="/sign-in" className="w-fit">
          <Brand />
        </Link>
        <div className="my-16 max-w-md">
          <span className="mb-8 flex size-14 items-center justify-center rounded-2xl border border-sidebar-border text-sidebar-ring">
            <Compass className="size-7" aria-hidden="true" />
          </span>
          <p className="font-heading text-[2.8rem] font-semibold leading-[1.18] tracking-tight">
            Your career.
            <br />
            With direction.
          </p>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-sidebar-foreground/75">
            A coach that gets to know you. A plan you can make your own. A next step that feels
            possible.
          </p>
          <div className="mt-10 flex flex-col gap-4 text-sm text-sidebar-foreground/80">
            {[
              "Start with what matters to you",
              "Turn possibilities into a practical plan",
              "Find your rhythm with weekly check-ins",
            ].map((text) => (
              <p key={text} className="flex items-center gap-3">
                <Check className="size-4 shrink-0 text-sidebar-ring" aria-hidden="true" />
                {text}
              </p>
            ))}
          </div>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          Self-hosted. Your AI provider. Your pace.
        </p>
      </aside>
      <div className="flex min-w-0 flex-col bg-card px-6 py-8 sm:px-12">
        <div className="mb-8 flex items-center justify-between gap-3">
          <Link href="/sign-in" className="w-fit lg:hidden">
            <Brand />
          </Link>
          <div className="ml-auto">
            <ThemeSelect />
          </div>
        </div>
        <div className="auth-content mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-6 lg:py-12">
          {children}
        </div>
        <div className="mx-auto mt-8 w-full max-w-[420px] border-t pt-6">
          <CareerJourney />
        </div>
      </div>
    </main>
  );
}
