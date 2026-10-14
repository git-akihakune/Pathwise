"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Compass,
  LogOut,
  Menu,
  MessageCircle,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { Brand } from "@/components/brand";
import { ThemeSelect } from "@/components/theme-select";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const ROUTES = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/coach", label: "Coach", icon: MessageCircle },
  { href: "/plan", label: "Plan", icon: Compass },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/stories", label: "Stories", icon: BookOpen },
];

function Navigation({
  isAdmin,
  name,
  onNavigate,
}: {
  isAdmin: boolean;
  name: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const item = ({ href, label, icon: Icon }: (typeof ROUTES)[number]) => {
    const active =
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        {label}
        {active && <ChevronRight className="ml-auto size-4" aria-hidden="true" />}
      </Link>
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-8 bg-sidebar p-5 text-sidebar-foreground">
      <Link
        href="/"
        aria-label="Pathwise home"
        onClick={onNavigate}
        className="w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-sidebar-ring"
      >
        <Brand />
      </Link>
      <nav aria-label="Main navigation" className="flex flex-col gap-1">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/55">
          Workspace
        </p>
        {ROUTES.map(item)}
      </nav>
      <div className="mt-auto flex flex-col gap-5">
        <div className="rounded-xl border border-sidebar-border p-4">
          <span className="mb-2 block size-1.5 rounded-full bg-sidebar-ring" aria-hidden="true" />
          <p className="font-heading text-sm font-semibold">A direction. A next step.</p>
          <p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/65">
            Make room for the career you want, one week at a time.
          </p>
        </div>
        <nav aria-label="Account navigation" className="flex flex-col gap-1">
          {item({ href: "/settings", label: "Settings", icon: Settings })}
          {isAdmin && item({ href: "/admin", label: "Admin", icon: ShieldCheck })}
        </nav>
        <div className="flex items-center gap-3 border-t border-sidebar-border pt-5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent font-heading text-sm font-semibold"
            aria-hidden="true"
          >
            {name.trim().slice(0, 1).toUpperCase() || "P"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium">{name}</p>
            <p className="text-xs text-sidebar-foreground/60">Personal workspace</p>
          </div>
          <Form noValidate action={signOutAction}>
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              title="Sign out"
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}

export function AppNav({ isAdmin, name }: { isAdmin: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) setOpen(false);
  }, [pathname]);
  const current = [
    ...ROUTES,
    { href: "/settings", label: "Settings" },
    { href: "/admin", label: "Admin" },
    { href: "/onboarding", label: "Set up your coach" },
    { href: "/checkin", label: "Weekly check-in" },
  ].find(({ href }) => (href === "/" ? pathname === href : pathname.startsWith(href)));
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] overflow-y-auto lg:block">
        <Navigation isAdmin={isAdmin} name={name} />
      </aside>
      <header className="mobile-header flex min-h-16 items-center justify-between gap-4 border-b bg-card px-5 py-3 lg:hidden">
        <Link href="/" aria-label="Pathwise home">
          <Brand className="text-lg" />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeSelect />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              aria-label="Open navigation"
              className={buttonVariants({ variant: "outline", size: "icon" })}
            >
              <Menu className="size-5" aria-hidden="true" />
            </DialogTrigger>
            <DialogContent className="navigation-drawer inset-y-0 left-0 top-0 h-dvh max-h-dvh w-[min(320px,90vw)] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none bg-sidebar p-0 text-sidebar-foreground sm:max-w-none data-open:animate-none data-closed:animate-none">
              <DialogTitle className="sr-only">Navigation</DialogTitle>
              <DialogDescription className="sr-only">
                Navigate your Pathwise workspace.
              </DialogDescription>
              <Navigation isAdmin={isAdmin} name={name} onNavigate={() => setOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <div className="hidden h-16 items-center justify-between border-b border-border/70 bg-card/60 px-10 text-sm lg:flex">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Workspace</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span className="font-medium text-foreground">{current?.label ?? "Workspace"}</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Your changes stay in your control
          </span>
          <ThemeSelect />
        </div>
      </div>
    </>
  );
}
