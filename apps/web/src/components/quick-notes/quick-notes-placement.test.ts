import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layout = readFileSync(
  resolve(process.cwd(), "src/app/(workspace)/layout.tsx"),
  "utf8",
);

describe("Quick Notes global placement", () => {
  it("keeps the top-bar entry point inside the shell but the panel outside it", () => {
    expect(layout).toContain(
      "topBarExtra={identity.id ? <QuickNotesLauncher /> : null}",
    );

    const shellEnd = layout.indexOf("</WorkspaceShell>");
    const panelMount = layout.indexOf("<QuickNotesPanel />");
    expect(shellEnd).toBeGreaterThan(-1);
    expect(panelMount).toBeGreaterThan(shellEnd);
  });
});
