import { Flag, Footprints, Route } from "lucide-react";

export function CareerJourney({ className = "" }: { className?: string }) {
  return (
    <ol aria-label="From direction to action" className={`career-journey ${className}`}>
      {[
        { icon: Flag, title: "Your direction", detail: "A goal that fits you" },
        { icon: Route, title: "Your milestones", detail: "A route you can follow" },
        { icon: Footprints, title: "Your next step", detail: "Small actions, each week" },
      ].map(({ icon: Icon, title, detail }) => (
        <li key={title} className="relative flex min-w-0 flex-1 gap-3 sm:flex-col">
          <span className="journey-node relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-accent text-primary">
            <Icon className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-heading text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
