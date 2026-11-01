"use client";

import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

export function BacklogAddButton() {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-2")}
      onClick={() => window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT))}
      data-testid="backlog-add-item"
      aria-haspopup="dialog"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add to Backlog
    </button>
  );
}
