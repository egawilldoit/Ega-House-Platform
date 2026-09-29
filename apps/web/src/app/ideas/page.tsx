import { redirect } from "next/navigation";

type IdeasPageProps = {
  searchParams: Promise<{
    view?: string;
    q?: string;
    search?: string;
    type?: string;
    status?: string;
    project?: string;
    priority?: string;
    tag?: string;
  }>;
};

export const metadata = {
  title: "Backlog",
  description: "Keep ideas here until they are ready to become real work.",
};

/**
 * Compatibility redirect: /ideas → /backlog.
 *
 * Preserves the view and search query parameters from old links so existing
 * bookmarks and shared URLs land on the equivalent Backlog view.
 */
export default async function IdeasPage({ searchParams }: IdeasPageProps) {
  const resolved = await searchParams;
  const params = new URLSearchParams();

  if (resolved.view) {
    params.set("view", resolved.view);
  }

  const search = resolved.q ?? resolved.search;
  if (search?.trim()) {
    params.set("q", search.trim());
  }

  const query = params.toString();
  redirect(query ? `/backlog?${query}` : "/backlog");
}
