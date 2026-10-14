"use client";

import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import { useDirtyForm } from "@/components/form-guard";
import { Alert } from "@/components/ui/alert";

/** Owns constraint feedback and preserves entered values when React resets an action form. */
export function Form({
  children,
  onSubmit,
  onChange,
  onReset,
  result,
  dirty,
  error = result?.error,
  trackChanges = true,
  ...props
}: ComponentProps<"form"> & {
  error?: string;
  result?: { error?: string };
  trackChanges?: boolean;
  dirty?: boolean;
}) {
  const id = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const register = useDirtyForm();
  const revision = useRef(0);
  const submittedRevision = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => () => register(id, false), [id, register]);
  useEffect(() => {
    if (typeof dirty === "boolean") register(id, dirty);
  }, [dirty, id, register]);
  useEffect(() => {
    if (result && trackChanges)
      register(id, Boolean(result.error) || revision.current !== submittedRevision.current);
    if (error) errorRef.current?.focus();
  }, [result, error, id, register, trackChanges]);

  const submit: NonNullable<ComponentProps<"form">["onSubmit"]> = (event) => {
    const controls = Array.from(event.currentTarget.elements).filter(
      (control): control is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLSelectElement,
    );
    const invalid = controls.filter((control) => control.willValidate && !control.validity.valid);
    for (const control of controls) {
      if (invalid.includes(control)) {
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", `${id}-validation`);
      } else if (control.getAttribute("aria-describedby") === `${id}-validation`) {
        control.removeAttribute("aria-invalid");
        control.removeAttribute("aria-describedby");
      }
    }
    if (invalid.length) {
      event.preventDefault();
      const unique = invalid.filter(
        (control, index) =>
          control.type !== "radio" ||
          invalid.findIndex((other) => other.name === control.name) === index,
      );
      const messages = unique.map((control) => {
        const label =
          control.labels?.[0]?.textContent?.trim() ||
          control.getAttribute("aria-label") ||
          "this field";
        if (control.type === "radio") {
          const legend = control.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
          return `${legend ?? label} Choose one option.`;
        }
        return control.validity.valueMissing
          ? `Enter ${label.toLowerCase()}.`
          : `${label}: ${control.validationMessage}`;
      });
      setErrors(messages);
      invalid[0]?.focus();
      return;
    }
    setErrors([]);
    submittedRevision.current = revision.current;
    onSubmit?.(event);
  };

  return (
    <form
      {...props}
      noValidate
      data-unsaved={dirty === true ? "true" : undefined}
      onSubmit={submit}
      onChange={(event) => {
        revision.current += 1;
        if (trackChanges) register(id, true);
        onChange?.(event);
      }}
      onReset={(event) => {
        event.preventDefault();
        onReset?.(event);
      }}
    >
      {children}
      {errors.length > 0 && (
        <Alert id={`${id}-validation`} variant="destructive">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Alert variant="destructive">{error}</Alert>
        </div>
      )}
    </form>
  );
}
