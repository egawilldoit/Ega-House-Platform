import { notFound, redirect } from "next/navigation";

const WORKSPACE_REDIRECTS: Record<string, `/${string}`> = {
  dashboard: "/dashboard",
  goals: "/goals",
  tasks: "/tasks",
  timer: "/timer",
  review: "/review",
};

type AppsWorkspacePageProps = {
  params: Promise<{
    workspace: string;
  }>;
};

export default async function AppsWorkspacePage({ params }: AppsWorkspacePageProps) {
  const { workspace } = await params;
  const target = WORKSPACE_REDIRECTS[workspace];

  if (!target) {
    notFound();
  }

  redirect(target);
}
