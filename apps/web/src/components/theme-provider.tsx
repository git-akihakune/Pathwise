"use client";

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "pathwise-theme";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be unavailable; the system preference still works.
  }
  return "system";
}

function applyTheme(theme: Theme, systemDark: boolean) {
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && systemDark),
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const current = useRef<Theme>("system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    current.current = readTheme();
    setThemeState(current.current);
    applyTheme(current.current, media.matches);
    const onSystemChange = () => applyTheme(current.current, media.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      current.current = readTheme();
      setThemeState(current.current);
      applyTheme(current.current, media.matches);
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    current.current = next;
    applyTheme(next, window.matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the choice for this page even when persistence is blocked.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme requires ThemeProvider");
  return context;
}
