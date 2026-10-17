import Link from "next/link";

import { LOGIN_HREF, SIGNUP_HREF } from "../home-data";

export function SiteHeader() {
  return (
    <div className="home-wrap">
      <header className="home-top">
        <a className="home-brand" href="#top">
          <span className="home-logo" aria-hidden="true" />
          EGA House
        </a>
        <nav aria-label="Page">
          <a href="#product">Workspace</a>
          <a href="#loop">The loop</a>
          <Link href={LOGIN_HREF}>Log in</Link>
          <Link className="home-btn home-btn--solid home-btn--sm" href={SIGNUP_HREF}>
            Create account
          </Link>
        </nav>
      </header>
    </div>
  );
}
