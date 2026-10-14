"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  return (
    <Select
      value={theme}
      onValueChange={(value) => {
        if (value === "light" || value === "dark" || value === "system") setTheme(value);
      }}
    >
      <SelectTrigger aria-label="Theme" className="theme-select w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">
          <Sun aria-hidden="true" />
          Light
        </SelectItem>
        <SelectItem value="dark">
          <Moon aria-hidden="true" />
          Dark
        </SelectItem>
        <SelectItem value="system">
          <Monitor aria-hidden="true" />
          System
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
