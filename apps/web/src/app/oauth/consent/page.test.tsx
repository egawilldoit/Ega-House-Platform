import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";

import Page from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

type ReactElementNode = {
  type: unknown;
  props: Record<string, unknown>;
};

type SubmitButton = {
  name: string;
  value: string;
};

const authorizationIdParam = "auth-123";

const originalWritesFlag = process.env.MCP_WRITES_ENABLED;

function isReactElementNode(node: unknown): node is ReactElementNode {
  return (
    typeof node === "object"
    && node !== null
    && "type" in node
    && "props" in node
    && typeof node.props === "object"
    && node.props !== null
  );
}

function collectElements(
  root: unknown,
  predicate: (element: ReactElementNode) => boolean,
): ReactElementNode[] {
  const matches: ReactElementNode[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isReactElementNode(node)) return;
    if (predicate(node)) matches.push(node);
    visit(node.props.children);
  };

  visit(root);
  return matches;
}

function findSingleForm(tree: unknown): ReactElementNode {
  const forms = collectElements(tree, (element) => element.type === "form");
  expect(forms).toHaveLength(1);
  return forms[0];
}

function isPermissionProfileRadio(element: ReactElementNode): boolean {
  return (
    element.type === "input"
    && element.props.type === "radio"
    && element.props.name === "permission_profile"
  );
}

function isDecisionSubmitButton(element: ReactElementNode): boolean {
  return (
    element.type === "button"
    && element.props.type === "submit"
    && element.props.name === "decision"
  );
}

// Regression lock (blocker B8): collectFormValues walks ONLY the form's own
// subtree, the way a browser builds FormData for a submit. If the
// permission_profile radios are ever moved OUTSIDE the <form> again, they are
// absent from the collected values and the tests below fail.
function collectFormValues(
  form: ReactElementNode,
  submitter?: SubmitButton,
): Map<string, string> {
  const values = new Map<string, string>();
  const controls = collectElements(
    form,
    (element) =>
      element.type === "input"
      || element.type === "textarea"
      || element.type === "select",
  );

  for (const control of controls) {
    const name = control.props.name;
    if (typeof name !== "string" || name.length === 0) continue;
    if (control.props.type === "radio" || control.props.type === "checkbox") {
      if (control.props.defaultChecked === true) {
        values.set(name, String(control.props.value));
      }
      continue;
    }
    values.set(name, String(control.props.value ?? ""));
  }

  if (submitter) values.set(submitter.name, submitter.value);
  return values;
}

function cloneTreeWithCheckedRadio(
  node: unknown,
  name: string,
  checkedValue: string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((child) =>
      cloneTreeWithCheckedRadio(child, name, checkedValue),
    );
  }
  if (!isReactElementNode(node)) return node;

  const props: Record<string, unknown> = { ...node.props };
  if ("children" in props) {
    props.children = cloneTreeWithCheckedRadio(props.children, name, checkedValue);
  }
  if (node.type === "input" && props.type === "radio" && props.name === name) {
    props.defaultChecked = props.value === checkedValue;
  }
  return { type: node.type, props };
}

function createSupabaseMock() {
  // page.tsx -> normalizeAuthorizationDetails consumes a single `scope`
  // whitespace-separated string plus client_id/client_name/redirect_uri.
  const getAuthorizationDetails = vi.fn().mockResolvedValue({
    data: {
      authorization_id: authorizationIdParam,
      client_id: "client-1",
      client_name: "Hermes",
      scope: "openid",
      redirect_uri: "https://example.com/cb",
    },
    error: null,
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-123", email: "t@e.com" } },
        error: null,
      }),
      oauth: { getAuthorizationDetails },
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>;

  return { client, getAuthorizationDetails };
}

async function renderConsentPage(writesEnabled: boolean) {
  const { client, getAuthorizationDetails } = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(client);
  process.env.MCP_WRITES_ENABLED = writesEnabled ? "true" : "false";

  const tree = await Page({
    searchParams: Promise.resolve({ authorization_id: authorizationIdParam }),
  });

  return { tree, getAuthorizationDetails };
}

describe("OAuth consent page — permission_profile submission (blocker B8 regression lock)", () => {
  afterEach(() => {
    if (originalWritesFlag === undefined) {
      delete process.env.MCP_WRITES_ENABLED;
    } else {
      process.env.MCP_WRITES_ENABLED = originalWritesFlag;
    }
  });

  it("renders one POST form to /api/oauth/decision that owns the radios, hidden id, and both decision buttons", async () => {
    const { tree, getAuthorizationDetails } = await renderConsentPage(true);

    expect(getAuthorizationDetails).toHaveBeenCalledWith(authorizationIdParam);

    const form = findSingleForm(tree);
    expect(form.props.action).toBe("/api/oauth/decision");
    expect(form.props.method).toBe("post");

    const radiosInsideForm = collectElements(form, isPermissionProfileRadio);
    expect(
      radiosInsideForm.map((radio) => String(radio.props.value)).sort(),
    ).toEqual(["read_only", "workspace_manager"]);

    // No permission_profile radio may exist anywhere outside the form subtree.
    expect(collectElements(tree, isPermissionProfileRadio)).toHaveLength(
      radiosInsideForm.length,
    );

    const hiddenAuthorizationIds = collectElements(
      form,
      (element) =>
        element.type === "input"
        && element.props.type === "hidden"
        && element.props.name === "authorization_id",
    );
    expect(hiddenAuthorizationIds).toHaveLength(1);
    expect(hiddenAuthorizationIds[0].props.value).toBe(authorizationIdParam);

    const decisionValues = collectElements(form, isDecisionSubmitButton).map(
      (button) => String(button.props.value),
    );
    expect(decisionValues).toContain("deny");
    expect(decisionValues).toContain("approve");
  });

  it("simulated submit sends the checked profile and the authorization id from the form's own inputs", async () => {
    const { tree } = await renderConsentPage(true);
    const form = findSingleForm(tree);

    const radios = collectElements(form, isPermissionProfileRadio);
    const checkedRadios = radios.filter(
      (radio) => radio.props.defaultChecked === true,
    );
    expect(checkedRadios).toHaveLength(1);
    expect(String(checkedRadios[0].props.value)).toBe("read_only");

    const values = collectFormValues(form, {
      name: "decision",
      value: "approve",
    });
    expect(values.get("permission_profile")).toBe("read_only");
    expect(values.get("authorization_id")).toBe(authorizationIdParam);
    expect(values.get("decision")).toBe("approve");
  });

  it("submits workspace_manager when the user flips the checked radio", async () => {
    const { tree } = await renderConsentPage(true);

    const flippedTree = cloneTreeWithCheckedRadio(
      tree,
      "permission_profile",
      "workspace_manager",
    );
    const form = findSingleForm(flippedTree);

    const values = collectFormValues(form, { name: "decision", value: "deny" });
    expect(values.get("permission_profile")).toBe("workspace_manager");
    expect(values.get("authorization_id")).toBe(authorizationIdParam);
    expect(values.get("decision")).toBe("deny");
  });

  it("hides every permission_profile radio when MCP_WRITES_ENABLED is false", async () => {
    const { tree } = await renderConsentPage(false);

    expect(collectElements(tree, isPermissionProfileRadio)).toHaveLength(0);

    const form = findSingleForm(tree);
    const values = collectFormValues(form, { name: "decision", value: "deny" });
    expect(values.has("permission_profile")).toBe(false);
    expect(values.get("authorization_id")).toBe(authorizationIdParam);
    expect(values.get("decision")).toBe("deny");
  });
});
