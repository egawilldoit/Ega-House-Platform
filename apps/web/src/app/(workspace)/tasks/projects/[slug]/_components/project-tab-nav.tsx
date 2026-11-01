"use client";

import { useRouter } from "next/navigation";
import { useTransition, type KeyboardEvent } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const PROJECT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
  { value: "files", label: "Files" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

export function normalizeProjectTab(value: string | null | undefined): ProjectTab {
  if (value === "board") return "board";
  if (value === "list") return "list";
  if (value === "files") return "files";
  return "overview";
}

type ProjectTabNavProps = {
  activeTab: ProjectTab;
  /** Route path without a query string. */
  basePath: string;
  /** Current query string without the tab parameter. */
  search: string;
  projectName: string;
};

/**
 * URL-backed project sections. The active section is rendered on the server;
 * this client boundary only owns tab selection and navigation.
 */
export function ProjectTabNav({
  activeTab,
  basePath,
  search,
  projectName,
}: ProjectTabNavProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function hrefFor(value: ProjectTab) {
    const params = new URLSearchParams(search);

    if (value === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  function navigate(value: ProjectTab) {
    if (value === activeTab) return;
    startTransition(() => {
      router.push(hrefFor(value), { scroll: false });
    });
  }

  function focusTabAt(container: HTMLDivElement, index: number) {
    const trigger = container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
    trigger?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = PROJECT_TABS.findIndex((tab) => tab.value === activeTab);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % PROJECT_TABS.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + PROJECT_TABS.length) % PROJECT_TABS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PROJECT_TABS.length - 1;

    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = PROJECT_TABS[nextIndex];
    focusTabAt(event.currentTarget, nextIndex);
    navigate(nextTab.value);
  }

  return (
    <nav aria-label={`${projectName} sections`} className="flex flex-col gap-2">
      <Tabs
        value={activeTab}
        onValueChange={(value) => navigate(value as ProjectTab)}
        className="w-full sm:w-auto"
      >
        <TabsList
          role="tablist"
          aria-label="Project sections"
          onKeyDown={onKeyDown}
          className="grid w-full grid-cols-4 gap-1 sm:w-auto"
        >
          {PROJECT_TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                id={`project-tab-${tab.value}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={isActive ? `project-panel-${tab.value}` : undefined}
                tabIndex={isActive ? 0 : -1}
                className={cn(
                  "min-h-9 px-4 focus-visible:ring-2 focus-visible:ring-[var(--ega-focus-outline)] focus-visible:ring-offset-1",
                  isActive && "ring-1 ring-[var(--ega-border-strong)]",
                )}
              >
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      <span role="status" className="sr-only">
        {isPending ? "Loading project section" : ""}
      </span>
    </nav>
  );
}
