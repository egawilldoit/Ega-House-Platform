import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ShellIdentity } from "@/lib/workspace-shell";
import type { WebTimeContext } from "@/lib/services/time-context-service";

import { TimezoneCard } from "./timezone-card";

export function AccountSettings({
  identity,
  timeContext,
}: {
  identity: ShellIdentity;
  timeContext: WebTimeContext;
}) {
  return (
    <section aria-labelledby="account-heading" className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle id="account-heading">Profile</CardTitle>
          <CardDescription>
            Your verified sign-in identity. Profile details come from your account
            provider and are not edited here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="rows">
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                Name
              </dt>
              <dd className="text-[length:var(--text-body)] font-medium text-ega-text">
                {identity.name}
              </dd>
            </div>
            <div className="row">
              <dt className="flex-1 text-[length:var(--text-meta-lg)] text-ega-text-secondary">
                Email
              </dt>
              <dd className="break-all text-[length:var(--text-body)] font-medium text-ega-text">
                {identity.email || "Not available"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <TimezoneCard
        timezone={timeContext.timezone}
        persistedTimezone={timeContext.persistedTimezone}
        fallback={timeContext.fallback}
      />
    </section>
  );
}
