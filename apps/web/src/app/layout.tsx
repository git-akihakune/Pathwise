import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FormGuard } from "@/components/form-guard";
import { ThemeProvider } from "@/components/theme-provider";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "@fontsource-variable/manrope";
import "@fontsource-variable/source-sans-3";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Pathwise", template: "%s | Pathwise" },
  description:
    "Your career, with direction. A personal coach, a practical plan, and one next step at a time.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="font-sans" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static application-owned theme bootstrap, no user content. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <FormGuard>{children}</FormGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
