"use client";

import { useActionState } from "react";

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
          <span className="opacity-75">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
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
