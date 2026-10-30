import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Help",
  description: "Shortcuts, guidance and system references.",
};

const shortcuts = [
  { keys: "Cmd+K / Ctrl+K", action: "Open command palette" },
  { keys: "Cmd+Shift+T / Ctrl+Shift+T", action: "Go to Today" },
  { keys: "Cmd+Shift+N / Ctrl+Shift+N", action: "Go to Tasks" },
  { keys: "G then H", action: "Go to Home" },
  { keys: "G then T", action: "Go to Today" },
  { keys: "Esc", action: "Close drawer/dialog" },
];

export default function HelpPage() {
  return (
    <>
      <WorkspacePageHeader title="Help" description="Shortcuts, guidance and system references." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Keyboard shortcuts</CardTitle>
            <CardDescription>Fast navigation and actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-[color:var(--ega-border-subtle)]">
              {shortcuts.map((shortcut) => (
                <div key={shortcut.keys} className="flex items-center justify-between py-2">
                  <span className="text-[length:var(--text-body)]">{shortcut.action}</span>
                  <kbd className="rounded border border-[color:var(--ega-border-subtle)] px-2 py-0.5 text-xs">
                    {shortcut.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
