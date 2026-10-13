import type { AdminUserRow } from "@pathwise/core/admin";
import type { DeadLetterJob, QueueHealth } from "@pathwise/core/jobs";
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
import { discardDeadLetterAction, retryDeadLetterAction } from "./actions";

export function JobHealth({
  queues,
  deadLetters,
  users,
}: {
  queues: QueueHealth[];
  deadLetters: DeadLetterJob[];
  users: AdminUserRow[];
}) {
  const emails = new Map(users.map((u) => [u.id, u.email]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Job queue</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">Counts refresh about once a minute.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table aria-label="Job queue health">
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead>Queued</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Failed</TableHead>
              <TableHead>Dead-lettered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queues.map((q) => (
              <TableRow key={q.name}>
                <TableCell>{q.name}</TableCell>
                <TableCell>{q.queued}</TableCell>
                <TableCell>{q.active}</TableCell>
                <TableCell>{q.failed}</TableCell>
                <TableCell>{q.deadLettered}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <h3 className="font-semibold">Dead-lettered jobs</h3>
        {deadLetters.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dead-lettered jobs.</p>
        ) : (
          <Table aria-label="Dead-lettered jobs">
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Failed at</TableHead>
                <TableHead>Originally queued</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deadLetters.map((job) => (
                <TableRow key={`${job.queue}-${job.id}`}>
                  <TableCell>{job.sourceQueue}</TableCell>
                  <TableCell>{job.deadLetteredOn.toISOString()}</TableCell>
                  <TableCell>{job.createdOn.toISOString()}</TableCell>
                  <TableCell>{job.lastError ?? "—"}</TableCell>
                  <TableCell>
                    {job.userId ? (emails.get(job.userId) ?? "deleted user") : "deleted user"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <form action={retryDeadLetterAction}>
                        <input type="hidden" name="queue" value={job.queue} />
                        <input type="hidden" name="id" value={job.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Retry
                        </Button>
                      </form>
                      <form action={discardDeadLetterAction}>
                        <input type="hidden" name="queue" value={job.queue} />
                        <input type="hidden" name="id" value={job.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Discard
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
