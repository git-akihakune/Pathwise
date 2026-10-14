export const metadata = { title: "Admin" };

import { getJobHealth, listInvites, listUsers } from "@pathwise/core/admin";
import { getInstanceSettings, getSafetyResources } from "@pathwise/core/instance";
import { MODEL_SUGGESTIONS } from "@pathwise/core/llm";
import { getInstanceProviderConfig } from "@pathwise/core/services/providers";
import { usageByUser } from "@pathwise/core/services/usage";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { getJobAdmin } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireAdmin } from "@/lib/session";
import { promoteUserAction, revokeInviteAction } from "./actions";
import { InstanceProvider } from "./instance-provider";
import { InviteForm } from "./invite-form";
import { JobHealth } from "./job-health";
import { SafetyResourcesForm } from "./safety-resources-form";
import { SignupModeSelect } from "./signup-mode-select";

const DAY_MS = 86_400_000;
const date = (d: Date) => d.toISOString().slice(0, 10);

export default async function AdminPage() {
  await connection();
  const { userId } = await requireAdmin();
  const { db, config } = getServer();
  const [users, invites, settings, instanceProvider, usage, safetyResources, jobHealth] =
    await Promise.all([
      listUsers(db, userId),
      listInvites(db, userId),
      getInstanceSettings(db),
      getInstanceProviderConfig(db, userId),
      usageByUser(db, userId, new Date(Date.now() - 30 * DAY_MS)),
      getSafetyResources(db),
      getJobAdmin().then((jobs) => getJobHealth(db, jobs, userId)),
    ]);

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Admin"
        description="Manage this instance, its members, and the services that keep it running."
      />

      {config.smtp === null && (
        <Alert>
          Email is not configured. Check-ins are in-app only, and password resets need the CLI.
        </Alert>
      )}

      <section aria-labelledby="instance-provider-heading">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="instance-provider-heading">Instance provider</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InstanceProvider
              config={instanceProvider}
              allowCustom={config.customEndpoints !== "off"}
              suggestions={MODEL_SUGGESTIONS}
            />
          </CardContent>
        </Card>
      </section>

      <JobHealth {...jobHealth} users={users} />

      <section aria-labelledby="usage-heading">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="usage-heading">Usage (last 30 days)</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PaginatedTable
              label="Usage (last 30 days)"
              columns={4}
              empty="No usage yet."
              header={
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Input tokens</TableHead>
                  <TableHead>Output tokens</TableHead>
                </TableRow>
              }
              rows={usage.map((u) => (
                <TableRow key={`${u.userId}-${u.role}`}>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell>{u.inputTokens.toLocaleString("en-US")}</TableCell>
                  <TableCell>{u.outputTokens.toLocaleString("en-US")}</TableCell>
                </TableRow>
              ))}
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Safety resources</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Shown instead of a coaching reply when someone may be in crisis.
          </p>
        </CardHeader>
        <CardContent>
          <SafetyResourcesForm resources={safetyResources} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Sign-up</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SignupModeSelect value={settings.signupMode} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Invites</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <InviteForm />
          <PaginatedTable
            label="Invites"
            columns={4}
            empty="No invitations yet."
            header={
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            }
            rows={invites.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.email}</TableCell>
                <TableCell>
                  <Badge variant={i.status === "usable" ? "default" : "secondary"}>
                    {i.status}
                  </Badge>
                </TableCell>
                <TableCell>{date(i.expiresAt)}</TableCell>
                <TableCell>
                  {i.status === "usable" && (
                    <Form noValidate action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Revoke
                      </Button>
                    </Form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Users</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaginatedTable
            label="Users"
            columns={5}
            empty="No users yet."
            header={
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead />
              </TableRow>
            }
            rows={users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                </TableCell>
                <TableCell>{date(u.createdAt)}</TableCell>
                <TableCell>
                  {u.role === "user" && (
                    <Form noValidate action={promoteUserAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Make admin
                      </Button>
                    </Form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
