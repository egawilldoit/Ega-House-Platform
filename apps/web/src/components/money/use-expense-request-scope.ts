"use client";

import { useEffect, useRef } from "react";

/** Ignore responses from an earlier owner/row, including after unmount. */
export function useExpenseRequestScope(scopeKey: string) {
  const activeScope = useRef({ active: true });
  useEffect(() => {
    const scope = { active: true };
    activeScope.current = scope;
    return () => { scope.active = false; };
  }, [scopeKey]);

  return () => {
    const scope = activeScope.current;
    return () => scope.active;
  };
}
