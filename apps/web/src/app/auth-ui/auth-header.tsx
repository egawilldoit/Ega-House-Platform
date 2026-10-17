import Link from "next/link";

type AuthHeaderProps = {
  status: string;
  actionHref: string;
  actionLabel: string;
};

export function AuthHeader({ status, actionHref, actionLabel }: AuthHeaderProps) {
  return (
    <header className="auth-header">
      <Link className="auth-header__brand" href="/">
        <span className="auth-header__logo" aria-hidden="true" />
        EGA House
      </Link>
      <p className="auth-header__status">{status}</p>
      <Link className="auth-header__action" href={actionHref}>
        {actionLabel}
      </Link>
    </header>
  );
}
