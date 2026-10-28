import { ArchivePageView } from "@/app/archive/_components/ArchivePageView";
import { getArchivePageModel } from "@/app/archive/_lib/archive-page-model";

type ArchivePageProps = {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    archiveError?: string;
    archiveNotice?: string;
  }>;
};

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const resolvedSearchParams = await searchParams;
  const model = await getArchivePageModel(resolvedSearchParams);

  return <ArchivePageView model={model} />;
}
