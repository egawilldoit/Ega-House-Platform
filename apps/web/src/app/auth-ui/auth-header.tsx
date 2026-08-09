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
        EGA HOUSE
      </Link>
      <p className="auth-header__status">{status}</p>
      <Link className="auth-header__action" href={actionHref}>
        {actionLabel} <span aria-hidden="true">↗</span>
      </Link>
    </header>
  );
}
