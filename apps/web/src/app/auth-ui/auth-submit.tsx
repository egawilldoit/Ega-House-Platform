import { ArrowRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type AuthSubmitProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel: string;
  children: ReactNode;
};

export function AuthSubmit({
  pending = false,
  pendingLabel,
  children,
  disabled,
  ...props
}: AuthSubmitProps) {
  return (
    <button className="auth-submit" disabled={disabled || pending} {...props}>
      {pending ? (
        <>
          <span className="auth-spinner" aria-hidden="true" /> {pendingLabel}
        </>
      ) : (
        <>
          <span>{children}</span>
          <ArrowRight size={17} aria-hidden="true" />
        </>
      )}
    </button>
  );
}
