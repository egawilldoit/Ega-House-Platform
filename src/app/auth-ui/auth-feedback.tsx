import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

type AuthFeedbackProps = {
  tone?: "error" | "success";
  children: ReactNode;
  className?: string;
  tabIndex?: number;
};

export function AuthFeedback({
  tone = "error",
  children,
  className,
  tabIndex,
}: AuthFeedbackProps) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  const role = tone === "error" ? "alert" : "status";

  return (
    <div
      className={["auth-feedback", `auth-feedback--${tone}`, className].filter(Boolean).join(" ")}
      role={role}
      tabIndex={tabIndex}
    >
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
