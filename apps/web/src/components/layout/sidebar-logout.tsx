"use client";

import { useActionState } from "react";
import { LogOut } from "lucide-react";

import { signOutAction } from "./logout-actions";
import { INITIAL_SIGN_OUT_FORM_STATE } from "./logout-state";

export function SidebarLogout() {
  const [state, formAction, isPending] = useActionState(
    signOutAction,
    INITIAL_SIGN_OUT_FORM_STATE,
  );

  return (
    <div>
      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="sidebar-link w-full disabled:cursor-not-allowed disabled:opacity-70"
          aria-busy={isPending}
        >
          <span className="sidebar-link-icon">
            <LogOut />
          </span>
          {isPending ? "Signing out..." : "Logout"}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="px-5 pt-2 text-xs text-[var(--signal-error)]">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
