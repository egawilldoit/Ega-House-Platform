import Link from "next/link";

import { NavFrame } from "@/components/marketing/nav-frame";

import { LOGIN_HREF, SIGNUP_HREF } from "../home-data";

export function SiteHeader() {
  return (
    <NavFrame className="home-top">
      <div className="home-wrap home-top__inner">
        <a className="home-brand" href="#top">
          <span className="home-logo" aria-hidden="true" />
          EGA House
        </a>
        <nav aria-label="Page">
          <a className="home-top__page-link" href="#product">
            Workspace
          </a>
          <a className="home-top__page-link" href="#loop">
            The loop
          </a>
          <Link className="home-top__login" href={LOGIN_HREF}>
            Log in
          </Link>
          <Link className="home-btn home-btn--solid home-btn--sm" href={SIGNUP_HREF}>
            Create account
          </Link>
        </nav>
      </div>
    </NavFrame>
  );
}
