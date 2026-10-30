import { WorkspacePageHeader } from "@/components/layout/workspace-page-header";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getFavoritesPageModel } from "./_lib/favorites-page-model";
import { FavoritesPageView } from "./_components/FavoritesPageView";

export const metadata: Metadata = {
  title: "Favourites",
  description: "Starred projects and tasks for quick navigation.",
};

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const model = await getFavoritesPageModel();
  return (
    <>
      <WorkspacePageHeader title="Favourites" description="Starred projects and tasks for quick navigation." />
      <Suspense fallback={null}>
        <FavoritesPageView model={model} notice={resolvedSearchParams.notice} error={resolvedSearchParams.error} />
      </Suspense>
    </>
  );
}
