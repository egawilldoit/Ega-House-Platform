// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/tasks",
  useSearchParams: () => params,
}));

import { useTaskDrawerParam } from "./use-task-drawer-param";

let container: HTMLDivElement;
let root: Root;

/** Exposes the hook through real controls so the test drives it like a user. */
function Probe() {
  const { open, setMode, close } = useTaskDrawerParam();
  return (
    <div>
      <button type="button" onClick={() => open("t1")}>
        open
      </button>
      <button type="button" onClick={() => setMode("full")}>
        full
      </button>
      <button type="button" onClick={() => close()}>
        close
      </button>
    </div>
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockClear();
  replace.mockClear();
  params = new URLSearchParams("layout=board");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  act(() => {
    (button as HTMLButtonElement).click();
  });
}

describe("useTaskDrawerParam", () => {
  it("opens with a push so Back closes the drawer", () => {
    click("open");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBe("/tasks?layout=board&task=t1");
    expect(push.mock.calls[0][1]).toEqual({ scroll: false });
    expect(replace).not.toHaveBeenCalled();
  });

  it("switches mode with a replace", () => {
    params = new URLSearchParams("layout=board&task=t1");
    act(() => root.render(<Probe />));

    click("full");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toBe("/tasks?layout=board&task=t1&taskMode=full");
    expect(push).not.toHaveBeenCalled();
  });

  it("closes with a replace that keeps the list state", () => {
    params = new URLSearchParams("layout=board&task=t1&taskMode=full");
    act(() => root.render(<Probe />));

    click("close");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toBe("/tasks?layout=board");
  });
});
