import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to access your EGA House workspace.",
};

function LoginFormFallback() {
  return (
    <div
      className="w-full rounded-2xl p-10 backdrop-blur"
      style={{ border: "1px solid rgba(51,92,103,0.2)", background: "rgba(255,255,255,0.5)" }}
    >
      <div className="h-4 w-20 animate-pulse rounded-full" style={{ background: "rgba(51,92,103,0.15)" }} />
      <div className="mt-8 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
      <div className="mt-3 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
      <div className="mt-6 h-12 animate-pulse rounded-xl" style={{ background: "rgba(51,92,103,0.1)" }} />
    </div>
  );
}

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}
