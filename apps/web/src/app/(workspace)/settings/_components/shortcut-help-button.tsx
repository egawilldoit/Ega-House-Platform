"use client";

import { Keyboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SHORTCUT_HELP_EVENT } from "@/lib/workspace-events";

/** Opens the shared `?` shortcut sheet from Settings. */
export function ShortcutHelpButton() {
  return (
    <Button
      type="button"
      variant="muted"
      size="sm"
      className="gap-2"
      onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_HELP_EVENT))}
    >
      <Keyboard className="h-4 w-4" aria-hidden="true" />
      Keyboard shortcuts
    </Button>
  );
}
