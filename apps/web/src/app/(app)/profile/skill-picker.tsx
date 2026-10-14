"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchSkillsAction } from "./actions";

type Option = Awaited<ReturnType<typeof searchSkillsAction>>[number];
const SOURCE_TAGS = { onet: "O*NET", esco: "ESCO" } as const;

export function SkillPicker({
  initialName = "",
  initialTaxonomySkillId = "",
}: {
  initialName?: string;
  initialTaxonomySkillId?: string | null;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const [linkedId, setLinkedId] = useState(initialTaxonomySkillId ?? "");
  const [options, setOptions] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string>();
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!searching || composing || name.trim().length < 2) {
      setOptions([]);
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    setOptions([]);
    setError(undefined);
    setActive(-1);
    const timer = setTimeout(async () => {
      try {
        const found = await searchSkillsAction(name);
        if (!stale) setOptions(found);
      } catch {
        if (!stale)
          setError("Couldn't search skills. Try typing again, or keep this as a custom skill.");
      } finally {
        if (!stale) setLoading(false);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name, searching, composing]);

  const choose = (option: Option) => {
    setName(option.name);
    setLinkedId(option.id);
    setSearching(false);
    setOptions([]);
    setActive(-1);
    input.current?.focus();
  };
  const expanded = searching && !composing && name.trim().length >= 2;
  return (
    <div className="relative flex flex-col gap-2">
      <Label htmlFor={`${id}-input`}>Skill</Label>
      <div className="relative">
        <Input
          ref={input}
          id={`${id}-input`}
          name="name"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          value={name}
          required
          className="pr-12"
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(event) => {
            setName(event.target.value);
            setLinkedId("");
            setSearching(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              setSearching(false);
              setActive(-1);
            } else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setActive((current) =>
                event.key === "ArrowDown"
                  ? (current + 1) % options.length
                  : current <= 0
                    ? options.length - 1
                    : current - 1,
              );
            } else if (event.key === "Enter" && active >= 0 && options[active]) {
              event.preventDefault();
              choose(options[active]);
            }
          }}
        />
        {name && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear skill search"
            className="absolute right-0 top-0 text-muted-foreground"
            onClick={() => {
              setName("");
              setLinkedId("");
              setSearching(false);
              setOptions([]);
              setActive(-1);
              input.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <input type="hidden" name="taxonomySkillId" value={linkedId} />
      {expanded && (
        <div className="rounded-lg border border-input bg-popover p-1 shadow-xs">
          {loading && (
            <p
              role="status"
              className="flex min-h-10 items-center gap-2 px-3 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              Searching skills…
            </p>
          )}
          {!loading && options.length === 0 && (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {error ?? "No matches. You can keep this as a custom skill."}
            </p>
          )}
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label="Matching skills"
            className="max-h-60 overflow-y-auto"
          >
            {options.map((option, index) => (
              <button
                type="button"
                tabIndex={-1}
                key={option.id}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === active}
                aria-label={option.name}
                className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent ${index === active ? "bg-accent text-accent-foreground" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.name}</span>
                <span className="text-xs text-muted-foreground">{SOURCE_TAGS[option.source]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
