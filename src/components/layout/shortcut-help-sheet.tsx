"use client";

import { Keyboard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SHORTCUT_HELP_SECTIONS } from "@/lib/keyboard-shortcuts";

type ShortcutHelpSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShortcutHelpSheet({ open, onOpenChange }: ShortcutHelpSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col" aria-labelledby="shortcut-help-title">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 pb-4 pt-5 sm:px-6">
          <SheetHeader className="min-w-0">
            <p className="glass-label text-signal-live">Keyboard-first workspace</p>
            <SheetTitle id="shortcut-help-title">Keyboard shortcuts</SheetTitle>
            <SheetDescription>
              Stay in flow with route jumps and quick actions. Shortcuts pause automatically while you are typing.
            </SheetDescription>
          </SheetHeader>

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close shortcut help"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {SHORTCUT_HELP_SECTIONS.map((section) => (
            <section
              key={section.title}
              aria-labelledby={`shortcut-section-${section.title.toLowerCase()}`}
              className="rounded-[1rem] border border-[var(--border)] bg-white/90 p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-[0.8rem] border border-[var(--border)] bg-[color:var(--instrument)] text-[color:var(--muted-foreground)]">
                  <Keyboard className="h-4 w-4" />
                </span>
                <h3
                  id={`shortcut-section-${section.title.toLowerCase()}`}
                  className="text-sm font-semibold text-[color:var(--foreground)]"
                >
                  {section.title}
                </h3>
              </div>

              <ul className="space-y-2" aria-label={`${section.title} shortcuts`}>
                {section.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.id}
                    className="flex items-center justify-between gap-3 rounded-[0.9rem] border border-[var(--border)] bg-[color:var(--instrument)] px-3 py-2.5"
                  >
                    <span className="text-sm text-[color:var(--foreground)]">{shortcut.description}</span>
                    <kbd className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                      {shortcut.combo}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
