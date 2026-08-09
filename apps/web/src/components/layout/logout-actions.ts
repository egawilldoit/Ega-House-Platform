"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { executeSignOut } from "./logout-logic";
import type { SignOutFormState } from "./logout-state";

export async function signOutAction(
  _previousState: SignOutFormState,
  _formData: FormData,
): Promise<SignOutFormState> {
  void _previousState;
  void _formData;

  const supabase = await createClient();
  const requestHeaders = await headers();
  const result = await executeSignOut({
    signOut: () => supabase.auth.signOut(),
    requestHost:
      requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
  });

  if (result.error) {
    return { error: result.error };
  }

  redirect(result.redirectTo ?? "/login");
}
