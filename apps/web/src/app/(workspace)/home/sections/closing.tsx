import Link from "next/link";

import { RevealOnView } from "../components/reveal-on-view";
import { WeightRamp } from "../components/weight-ramp";
import { LOGIN_HREF, SIGNUP_HREF } from "../home-data";

const CLOSING_LINES = [
  [
    { text: "Return", weight: 200 },
    { text: "to the", weight: 420 },
    { text: "system.", weight: 800 },
  ],
];

export function Closing() {
  return (
    <RevealOnView className="home-close">
      <div className="home-wrap">
        <WeightRamp as="h2" lines={CLOSING_LINES} />
        <div className="home-actions">
          <Link className="home-btn home-btn--solid" href={LOGIN_HREF}>
            Enter workspace
          </Link>
          <Link className="home-btn" href={SIGNUP_HREF}>
            Create account
          </Link>
        </div>
      </div>
    </RevealOnView>
  );
}
