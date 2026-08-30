"use client";

import { useEffect, useRef, useState } from "react";

export function ConsentApprovalLabel() {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [workspaceManagerSelected, setWorkspaceManagerSelected] = useState(false);

  useEffect(() => {
    const form = labelRef.current?.closest("form");
    if (!form) return;

    const updateLabel = () => {
      const selected = form.querySelector<HTMLInputElement>(
        'input[name="permission_profile"]:checked',
      );
      setWorkspaceManagerSelected(selected?.value === "workspace_manager");
    };

    updateLabel();
    form.addEventListener("change", updateLabel);
    return () => form.removeEventListener("change", updateLabel);
  }, []);

  return (
    <span ref={labelRef}>
      {workspaceManagerSelected
        ? "Approve workspace management"
        : "Approve read-only access"}
    </span>
  );
}
