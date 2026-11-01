import Link from "next/link";

import { LOGIN_HREF, SIGNUP_HREF } from "../home-data";

export function SiteFooter() {
  return (
    <div className="home-wrap">
      <footer className="home-footer">
        <span>© 2026 EGA House</span>
        <nav aria-label="Account">
          <Link href={LOGIN_HREF}>Log in</Link>
          <Link href={SIGNUP_HREF}>Create account</Link>
        </nav>
      </footer>
    </div>
  );
}
