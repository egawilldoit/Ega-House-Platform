import "./home.css";
import "./home-polish.css";

import { HomeMotion } from "./components/home-motion";
import { StudyHeader } from "./components/study-header";
import { ConversionStudy } from "./sections/conversion-study";
import { FocusStudy } from "./sections/focus-study";
import { GoalsStudy } from "./sections/goals-study";
import { HeroStudy } from "./sections/hero-study";
import { PlanningStudy } from "./sections/planning-study";
import { ReviewStudy } from "./sections/review-study";

export function HomePage() {
  return (
    <HomeMotion>
      <div className="home-page">
        <a className="home-skip-link" href="#intro">
          Skip to homepage content
        </a>
        <StudyHeader />
        <main className="home-page__main">
          <HeroStudy />
          <GoalsStudy />
          <PlanningStudy />
          <FocusStudy />
          <ReviewStudy />
          <ConversionStudy />
        </main>
      </div>
    </HomeMotion>
  );
}
