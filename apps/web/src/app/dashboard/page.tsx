import { redirect } from "next/navigation";

export const metadata = {
  title: "Dashboard",
  description: "Compatibility redirect to the canonical Operator.",
};

export default function DashboardPage() {
  redirect("/today");
}
