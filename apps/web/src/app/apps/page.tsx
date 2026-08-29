import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";

import { AppsLauncherGrid } from "./apps-launcher-grid";
import { APPS_LAUNCHER_ITEMS } from "./launcher-items";

export const metadata: Metadata = {
  title: "Apps",
  description: "Launcher for workspace modules and execution surfaces.",
};

export default async function AppsIndexPage() {
  return (
    <AppShell
      eyebrow="Surfaces"
      title="Apps"
      description="Open the module you need without leaving context."
    >
      <div className="space-y-4">
        <p className="glass-label text-etch">
          Navigate with mouse, tab, or arrow keys. Press Enter or Space to open.
        </p>
        <AppsLauncherGrid items={APPS_LAUNCHER_ITEMS} />
      </div>
    </AppShell>
  );
}
