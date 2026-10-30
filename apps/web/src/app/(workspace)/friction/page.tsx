import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { getFrictionPageModel } from "./_lib/friction-page-model";
import { FrictionPageView } from "./_components/FrictionPageView";

export const metadata: Metadata = {
  title: "Friction",
  description: "Signals slowing down execution and recommended actions.",
};

export default async function FrictionPage() {
  const model = await getFrictionPageModel();
  return (
    <>
      <WorkspacePageHeader title="Friction" description="Signals slowing down execution and recommended actions." />
      <FrictionPageView model={model} />
    </>
  );
}
