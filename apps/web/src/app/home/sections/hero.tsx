import Link from "next/link";

import { HeroGrid } from "../components/hero-grid";
import { LiveBoard } from "../components/live-board";
import { WeightRamp } from "../components/weight-ramp";
import { LOGIN_HREF, SIGNUP_HREF } from "../home-data";

const HERO_LINES = [
  [{ text: "Turn", weight: 200 }],
  [
    { text: "intention", weight: 320 },
    { text: "into", weight: 520 },
  ],
  [{ text: "execution.", weight: 800 }],
];

export function Hero() {
  return (
    <HeroGrid>
      <div className="home-wrap">
        <div className="home-hero__grid">
          <WeightRamp lines={HERO_LINES} />
          <div>
            <p className="home-lead">
              EGA House links what you want to what you did this week: goals, tasks, focus
              sessions, and a weekly review in one workspace.
            </p>
            <div className="home-actions">
              <Link className="home-btn home-btn--solid" href={LOGIN_HREF}>
                Enter workspace
              </Link>
              <Link className="home-btn" href={SIGNUP_HREF}>
                Create account
              </Link>
            </div>
          </div>
        </div>

        <LiveBoard />

        <p className="home-hint">
          This board is live. Tick a task and today’s execution moves with it.
        </p>
      </div>
    </HeroGrid>
  );
}
