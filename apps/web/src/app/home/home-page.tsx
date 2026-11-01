import "./home.css";

import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { Closing } from "./sections/closing";
import { Hero } from "./sections/hero";
import { Loop } from "./sections/loop";

export function HomePage() {
  return (
    <div className="home-page">
      <a className="home-skip-link" href="#top">
        Skip to homepage content
      </a>
      <SiteHeader />
      <main>
        <Hero />
        <Loop />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
