"use client";

import { useEffect, useId, useState } from "react";
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
  const listId = useId();
  const [name, setName] = useState(initialName);
  const [linkedId, setLinkedId] = useState(initialTaxonomySkillId ?? "");
  const [options, setOptions] = useState<Option[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!searching || name.trim().length < 2) {
      setOptions([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      const found = await searchSkillsAction(name);
      if (!stale) setOptions(found);
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name, searching]);

  const choose = (o: Option) => {
    setName(o.name);
    setLinkedId(o.id);
    setSearching(false);
    setOptions([]);
  };

  const expanded = options.length > 0;
  return (
    <div className="relative flex flex-col gap-1">
      <Label className="flex-col items-start gap-1">
        Skill
        <Input
          name="name"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={name}
          required
          onChange={(e) => {
            setName(e.target.value);
            setLinkedId("");
            setSearching(true);
          }}
          onKeyDown={(e) => e.key === "Escape" && setOptions([])}
        />
      </Label>
      <input type="hidden" name="taxonomySkillId" value={linkedId} />
      <ul
        id={listId}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox pattern requires a listbox.
        role="listbox"
        hidden={!expanded}
        className="rounded-md border bg-background text-sm shadow-xs"
      >
        {options.map((o) => (
          <li
            key={o.id}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the combobox pattern requires options.
            role="option"
            tabIndex={0}
            aria-label={o.name}
            aria-selected={o.id === linkedId}
            className="flex cursor-pointer justify-between px-2.5 py-1.5 hover:bg-muted"
            onClick={() => choose(o)}
            onKeyDown={(e) => e.key === "Enter" && choose(o)}
          >
            {o.name}
            <span className="text-xs text-muted-foreground">{SOURCE_TAGS[o.source]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
