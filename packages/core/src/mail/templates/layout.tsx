import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export const FOOTER =
  "You're getting this because weekly check-ins are on. You can turn them off in Settings.";

const font = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

export function Layout({
  preview,
  footer = true,
  children,
}: {
  preview: string;
  /** Omitted for auth and invite emails. */
  footer?: boolean;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f6f6f4", fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 8,
            padding: "24px 32px",
            maxWidth: 520,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Pathwise</Text>
          {children}
          {footer && (
            <Text style={{ color: "#6b6b66", fontSize: 12, marginTop: 24 }}>{FOOTER}</Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 15, lineHeight: "22px", margin: "0 0 12px" }}>{children}</Text>;
}

export function CtaButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "20px 0" }}>
      <Button
        href={href}
        style={{
          backgroundColor: "#1f3d36",
          color: "#ffffff",
          borderRadius: 6,
          padding: "10px 18px",
          fontSize: 15,
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}
