"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

const DirtyForms = createContext<(id: string, dirty: boolean) => void>(() => {});
export const useDirtyForm = () => useContext(DirtyForms);

export function FormGuard({ children }: { children: ReactNode }) {
  const forms = useRef(new Set<string>());
  const router = useRouter();
  const [destination, setDestination] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const register = useCallback((id: string, dirty: boolean) => {
    if (dirty) forms.current.add(id);
    else forms.current.delete(id);
  }, []);
  const hasUnsavedChanges = useCallback(
    () =>
      forms.current.size > 0 ||
      Array.from(document.querySelectorAll('[data-unsaved="true"]')).some(
        (form) => form.getClientRects().length > 0,
      ),
    [],
  );

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [hasUnsavedChanges]);

  // React's capture phase also receives clicks replayed after selective hydration.
  const navigate = (event: MouseEvent<HTMLDivElement>) => {
    if (
      !hasUnsavedChanges() ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (
      url.origin === location.origin &&
      url.pathname === location.pathname &&
      url.search === location.search
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    trigger.current = link;
    setDestination(link.href);
  };
  const discard = () => {
    if (!destination) return;
    forms.current.clear();
    const url = new URL(destination);
    setDestination(null);
    if (url.origin === location.origin) router.push(`${url.pathname}${url.search}${url.hash}`);
    else window.location.assign(destination);
  };

  return (
    <DirtyForms.Provider value={register}>
      <div className="contents" onClickCapture={navigate}>
        {children}
      </div>
      <Dialog open={destination !== null} onOpenChange={(open) => !open && setDestination(null)}>
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            keepRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>Leave your unsaved changes?</DialogTitle>
          <DialogDescription>
            Your edits haven't been saved. Keep editing, or discard them to leave this page.
          </DialogDescription>
          <DialogFooter>
            <Button ref={keepRef} variant="outline" onClick={() => setDestination(null)}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={discard}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DirtyForms.Provider>
  );
}
