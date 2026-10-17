import Link from "next/link";

import { NavFrame } from "@/components/marketing/nav-frame";

type AuthHeaderProps = {
  status: string;
  actionHref: string;
  actionLabel: string;
};

export function AuthHeader({ status, actionHref, actionLabel }: AuthHeaderProps) {
  return (
    <NavFrame className="auth-header">
      <div className="auth-header__inner">
        <Link className="auth-header__brand" href="/">
          <span className="auth-header__logo" aria-hidden="true" />
          EGA House
        </Link>
        <p className="auth-header__status">{status}</p>
        <Link className="auth-header__action" href={actionHref}>
          {actionLabel}
        </Link>
      </div>
    </NavFrame>
  );
}
