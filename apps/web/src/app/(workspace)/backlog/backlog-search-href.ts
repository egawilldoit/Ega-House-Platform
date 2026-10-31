export function getBacklogClearSearchHref(
  params: Record<string, string | undefined>,
): string {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "q" || key === "search") continue;
    if (typeof value === "string" && value.trim()) {
      nextParams.set(key, value);
    }
  }
  const query = nextParams.toString();
  return query ? `/backlog?${query}` : "/backlog";
}
