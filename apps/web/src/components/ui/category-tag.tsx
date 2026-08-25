import { cn } from "@/lib/utils";

type Category = "deep-work" | "meeting" | "review" | "focus" | "admin" | string;

const CATEGORY_MAP: Record<string, { bg: string; color: string; border: string; label: string }> = {
  "deep-work": { bg: "rgba(181,117,74,0.10)", color: "var(--category-deep-work)", border: "rgba(181,117,74,0.18)", label: "Deep work" },
  "deep_work": { bg: "rgba(181,117,74,0.10)", color: "var(--category-deep-work)", border: "rgba(181,117,74,0.18)", label: "Deep work" },
  meeting: { bg: "rgba(91,111,204,0.10)", color: "var(--category-meeting)", border: "rgba(91,111,204,0.18)", label: "Meeting" },
  review: { bg: "rgba(147,88,143,0.10)", color: "var(--category-review)", border: "rgba(147,88,143,0.18)", label: "Review" },
  focus: { bg: "rgba(46,140,140,0.10)", color: "var(--category-focus)", border: "rgba(46,140,140,0.18)", label: "Focus" },
  admin: { bg: "rgba(110,122,138,0.10)", color: "var(--category-admin)", border: "rgba(110,122,138,0.18)", label: "Admin" },
};

export function CategoryTag({ category, className, children }: { category: Category; className?: string; children?: React.ReactNode }) {
  const key = category.toLowerCase().replace(/\s+/g, "-");
  const entry = CATEGORY_MAP[key] ?? { bg: "var(--status-pending-bg)", color: "var(--status-pending)", border: "var(--status-pending-border)", label: category };
  return (
    <span
      className={cn("inline-flex items-center rounded-[var(--radius-pill)] border px-2 py-0.5 text-xs font-medium leading-none", className)}
      style={{ background: entry.bg, color: entry.color, borderColor: entry.border }}
    >
      {children ?? entry.label}
    </span>
  );
}
