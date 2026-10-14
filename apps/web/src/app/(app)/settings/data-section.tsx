import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DeleteAccountDialog } from "./delete-account-dialog";

export function DataSection({ email }: { email: string }) {
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
        <a
          href="/api/account/export"
          download
          className={buttonVariants({ className: "self-start" })}
        >
          Download my data
        </a>
        <DeleteAccountDialog email={email} />
      </CardContent>
    </Card>
  );
}
