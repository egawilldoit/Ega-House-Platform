/** Visual signal tone shared by the Tasks board and project board cards. */
export function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") return "bg-[var(--status-overdue)]";
  if (priority === "high") return "bg-[var(--status-risk)]";
  if (status === "in_progress") return "bg-[var(--status-info)]";
  return "bg-[var(--ega-text-tertiary)]";
}
