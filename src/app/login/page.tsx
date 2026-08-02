import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

const PUBLIC_SIGNUP_URL = "https://www.egawilldoit.online/signup";

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

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const nextParam = typeof params.next === "string" ? params.next : null;
  const signupHref = nextParam
    ? `${PUBLIC_SIGNUP_URL}?next=${encodeURIComponent(nextParam)}`
    : PUBLIC_SIGNUP_URL;
  const confirmationFailed = params.error === "confirmation_failed";

  return (
    <>
      {confirmationFailed ? (
        <div
          role="alert"
          className="fixed left-1/2 top-5 z-50 w-[min(92vw,540px)] -translate-x-1/2 rounded-2xl border border-red-900/15 bg-white/90 px-5 py-4 text-sm font-medium text-red-900 shadow-xl backdrop-blur-xl"
        >
          That confirmation link is invalid or expired. Create a new account or sign in if you already confirmed it.
        </div>
      ) : null}

      <div className="fixed right-4 top-4 z-40 rounded-full border border-[#1E3A3D]/15 bg-white/55 px-4 py-2 text-sm text-[#1E3A3D] shadow-sm backdrop-blur-xl sm:right-7 sm:top-7">
        New here?{" "}
        <Link className="font-bold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9e2a2b]" href={signupHref}>
          Create an account
        </Link>
      </div>

      <Suspense fallback={<LoginFormFallback />}>
        <LoginForm signupHref={signupHref} />
      </Suspense>
    </>
  );
}
