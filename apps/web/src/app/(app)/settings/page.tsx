import { MODEL_SUGGESTIONS } from "@pathwise/core/llm";
import { getProviderStatusForUser, listProviderConfigs } from "@pathwise/core/services/providers";
import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import { connection } from "next/server";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { CheckinScheduleForm } from "./checkin-schedule-form";
import { CoachSettings } from "./coach-settings";
import { DataSection } from "./data-section";
import { ProviderList } from "./provider-list";

export default async function SettingsPage() {
  await connection();
  const { userId, role, email } = await requireSession();
  const { db, config } = getServer();
  const [configs, settings, status] = await Promise.all([
    listProviderConfigs(db, userId),
    getUserSettings(db, userId),
    getProviderStatusForUser(db, userId),
  ]);
  const allowCustom =
    config.customEndpoints === "all" ||
    (config.customEndpoints === "admin_only" && role === "admin");

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {config.llmMode === "mock" && (
        <Alert>Mock mode: AI replies are simulated (LLM_MODE=mock).</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>AI provider</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status.source === "instance" && (
            <p className="text-sm text-muted-foreground">
              You're using the instance provider set by your admin. Add your own below to use your
              own key.
            </p>
          )}
          <ProviderList
            configs={configs}
            activeId={settings.providerConfigId}
            allowCustom={allowCustom}
            suggestions={MODEL_SUGGESTIONS}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Coach</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CoachSettings
            bluntness={settings.bluntness}
            timezone={settings.timezone}
            timezones={Intl.supportedValuesOf("timeZone")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Check-ins</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CheckinScheduleForm
            enabled={settings.checkinEnabled}
            day={settings.checkinDay}
            time={settings.checkinTime}
            emailEnabled={settings.emailEnabled}
            timezone={effectiveTimezone(settings)}
            smtpConfigured={config.smtp !== null}
          />
        </CardContent>
      </Card>
      <DataSection email={email} />
    </section>
  );
}
