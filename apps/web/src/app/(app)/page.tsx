import { requireSession } from "@/lib/session";

export default async function TodayPage() {
  const { name } = await requireSession();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Welcome, {name}</h1>
      <p className="text-muted-foreground">
        Your coach is being set up. Coaching features arrive in upcoming releases.
      </p>
    </section>
  );
}
