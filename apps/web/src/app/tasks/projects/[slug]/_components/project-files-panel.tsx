import {
  DEFAULT_ATTACHMENT_SORT,
  DEFAULT_ATTACHMENT_TYPE_FILTER,
  isAttachmentSort,
  isAttachmentTypeFilter,
  normalizeAttachmentSearch,
} from "@ega/domain";

import { listProjectAttachments } from "@/lib/services/attachment-service";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectFilesTab } from "./project-files-tab";

type ProjectFilesPanelProps = {
  projectId: string;
  projectSlug: string;
  view: string;
  kindParam?: string;
  queryParam?: string;
  sortParam?: string;
};

/** Bounded loading state for the Files tab, shown while the read model streams. */
export function ProjectFilesPanelSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading project files">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Server-side Files read model. The tab itself is a client component only for
 * preview/download/delete interactions; the authorized, bounded query runs here.
 */
export async function ProjectFilesPanel({
  projectId,
  projectSlug,
  view,
  kindParam,
  queryParam,
  sortParam,
}: ProjectFilesPanelProps) {
  const kind = isAttachmentTypeFilter(kindParam)
    ? kindParam
    : DEFAULT_ATTACHMENT_TYPE_FILTER;
  const sort = isAttachmentSort(sortParam) ? sortParam : DEFAULT_ATTACHMENT_SORT;
  const query = normalizeAttachmentSearch(queryParam);

  const result = await listProjectAttachments(projectId, { kind, query, sort });

  return (
    <ProjectFilesTab
      projectSlug={projectSlug}
      view={view}
      files={result.data}
      filters={{ kind, query, sort }}
      pendingCount={result.pendingCount}
      failedCount={result.failedCount}
      errorMessage={result.errorMessage}
    />
  );
}
