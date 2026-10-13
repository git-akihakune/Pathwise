import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DataSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Your data</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Download a zip of everything Pathwise stores about you: profile, stories, plan,
          conversations, and uploaded files. API keys are never included.
        </p>
        <Button asChild className="self-start">
          <a href="/api/account/export" download>
            Download my data
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
