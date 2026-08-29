import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/services/auth-service";

import { HomePage } from "./home/home-page";

export default async function Page() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/today");
  }

  return <HomePage />;
}
