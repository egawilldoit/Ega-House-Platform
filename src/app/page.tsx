import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/services/auth-service";

import { HomePage } from "./home/home-page";

// Keeps the public homepage route included in branch preview builds.
export default async function Page() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return <HomePage />;
}
