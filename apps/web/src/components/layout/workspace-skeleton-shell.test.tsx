import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceSkeletonShell } from "./workspace-skeleton-shell";

const root = process.cwd();

function collectLoadingBoundaries(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectLoadingBoundaries(path));
    } else if (entry === "loading.tsx") {
      found.push(path);
    }
  }
  return found;
}

const loadingBoundaries = collectLoadingBoundaries(resolve(root, "src/app"));

describe("authenticated loading boundaries", () => {
  it("finds every route loading boundary", () => {
    expect(loadingBoundaries.length).toBeGreaterThan(10);
  });

  it("keeps every loading boundary free of authentication and data reads", () => {
    for (const file of loadingBoundaries) {
      const source = readFileSync(file, "utf8");
      const relative = file.replace(`${root}/`, "");

      expect(source, `${relative} must not render the data-bound AppShell`).not.toMatch(
        /@\/components\/layout\/app-shell/,
      );
      expect(
        source,
        `${relative} must not render the data-bound TasksWorkspaceShell`,
      ).not.toMatch(/tasks-workspace-shell/);
      expect(source, `${relative} must not read Supabase`).not.toMatch(/@\/lib\/supabase/);
      expect(source, `${relative} must not call web services`).not.toMatch(/@\/lib\/services/);
      expect(
        source,
        `${relative} must not resolve identity or shell metrics`,
      ).not.toMatch(/@\/lib\/workspace-shell/);
      expect(
        source,
        `${relative} must use the data-free skeleton shell`,
      ).toMatch(/@\/components\/layout\/workspace-skeleton-shell/);
    }
  });

  it("keeps the skeleton shell itself free of data dependencies", () => {
    const source = readFileSync(
      resolve(root, "src/components/layout/workspace-skeleton-shell.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/@\/lib\/supabase/);
    expect(source).not.toMatch(/@\/lib\/services/);
    expect(source).not.toMatch(/@\/lib\/workspace-shell/);
    expect(source).not.toMatch(/async function/);
  });

  it("renders the shell geometry without fetching shell data", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSkeletonShell title="Tasks" description="Find, organize, and move your work forward.">
        <div>route-content</div>
      </WorkspaceSkeletonShell>,
    );

    expect(markup).toContain("app-shell");
    expect(markup).toContain("app-sidebar");
    expect(markup).toContain("app-topbar");
    expect(markup).toContain("app-page-title");
    expect(markup).toContain("Tasks");
    expect(markup).toContain("route-content");
  });
});
