import type { ReactNode } from "react";

type AuthFieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
};

export function AuthField({
  id,
  label,
  hint,
  help,
  error,
  trailing,
  children,
}: AuthFieldProps) {
  return (
    <div className="auth-field">
      <div className="auth-field__label-row">
        <label className="auth-field__label" htmlFor={id}>
          {label}
        </label>
        {hint ? <span className="auth-field__hint">{hint}</span> : null}
      </div>
      <div className="auth-field__control">
        {children}
        {trailing ? <span className="auth-field__trailing">{trailing}</span> : null}
      </div>
      {help ? <div className="auth-field__help">{help}</div> : null}
      {error ? <div className="auth-field__error">{error}</div> : null}
    </div>
  );
}
