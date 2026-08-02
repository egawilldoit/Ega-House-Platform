import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";

import styles from "./signup.module.css";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your secure EGA House workspace.",
};

function SignupFallback() {
  return (
    <main className={styles.root} aria-label="Loading signup">
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.shell}>
        <div className={styles.story} />
        <div className={styles.formColumn}>
          <div className={styles.formCard}>
            <div className={styles.formContent}>
              <div className={styles.eyebrow}>Preparing signup</div>
              <div className={styles.formTitle}>Create your secure workspace</div>
              <div className={styles.formIntro}>Loading the protected account form…</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default async function SignupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupForm />
    </Suspense>
  );
}
