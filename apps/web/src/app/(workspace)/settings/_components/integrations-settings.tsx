import { ExternalLink } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgentRegistryList } from "@/lib/services/agent-registry-service";
import type { CalendarIntegrationSettingsView } from "@/lib/services/calendar-settings-service";

import { AgentSettings } from "./agent-settings";
import { CalendarIntegrationCard } from "./calendar-integration-card";

const HERMES_EXECUTION_DOC =
  "https://github.com/egawilldoit/Ega-House-Platform/blob/main/docs/architecture/hermes-execution.md";

/**
 * Integrations tab: Calendar, agent/MCP credentials and the external Hermes
 * execution contract. Agent identity management is absorbed from the retired
 * `/agents` route; credentials remain the only source of agent capability.
 */
export function IntegrationsSettings({
  calendar,
  agents,
}: {
  calendar: CalendarIntegrationSettingsView;
  agents: AgentRegistryList;
}) {
  return (
    <div className="flex flex-col gap-6">
      <CalendarIntegrationCard settings={calendar} />
      <AgentSettings registry={agents} />

      <Card>
        <CardHeader>
          <CardTitle>Hermes</CardTitle>
          <CardDescription>
            Hermes is the external execution agent used by the delivery Runner.
            Its repository contract describes how Runner-owned evidence and
            independent verification stay separate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={HERMES_EXECUTION_DOC}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 text-[length:var(--text-body)] font-medium underline underline-offset-2"
          >
            Open the Hermes execution contract
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
