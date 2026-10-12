import { listInvites, listUsers } from "@pathwise/core/admin";
import { getInstanceSettings } from "@pathwise/core/instance";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getServer } from "@/lib/server";
import { requireAdmin } from "@/lib/session";
import { revokeInviteAction } from "./actions";
import { InviteForm } from "./invite-form";
import { SignupModeSelect } from "./signup-mode-select";

const date = (d: Date) => d.toISOString().slice(0, 10);

export default async function AdminPage() {
  await connection();
  const { userId } = await requireAdmin();
  const { db } = getServer();
  const [users, invites, settings] = await Promise.all([
    listUsers(db, userId),
    listInvites(db, userId),
    getInstanceSettings(db),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Admin</h1>

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((i) => (
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
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="inviteId" value={i.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Users</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.name}</TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                  </TableCell>
                  <TableCell>{date(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
