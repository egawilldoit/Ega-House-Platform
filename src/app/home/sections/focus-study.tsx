import { AnimatedRule } from "../components/animated-rule";
import { Reveal, ScrollOrbit } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy } from "../home-data";

export function FocusStudy() {
  const study = getStudy("focus");

  return (
    <StudyShell study={study} className="home-focus">
      <div className="home-study-copy home-focus__copy">
        <Reveal>
          <p className="home-kicker">Attention is an operating resource.</p>
        </Reveal>
        <h2 id="focus-title" className="home-display home-focus__title">
          <Reveal className="home-display__line">Turn attention</Reveal>
          <Reveal className="home-display__line" delay={0.07}>
            into momentum.
          </Reveal>
        </h2>
        <Reveal delay={0.14}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <AnimatedRule />
        <Reveal className="home-focus__task" delay={0.18}>
          <span>ACTIVE TASK</span>
          <strong>Refactor the public command surface</strong>
          <small>Goal: Ship the EGA operating loop</small>
        </Reveal>
      </div>

      <ScrollOrbit className="home-focus-clock">
        <div className="home-focus-clock__orbit" aria-hidden="true">
          <span className="home-focus-clock__ring home-focus-clock__ring--outer" />
          <span className="home-focus-clock__ring home-focus-clock__ring--middle" />
          <span className="home-focus-clock__ring home-focus-clock__ring--inner" />
          <span className="home-focus-clock__signal" />
        </div>
        <div className="home-focus-clock__readout">
          <span>FOCUS SESSION</span>
          <strong>25:00</strong>
          <small>Ready · Context linked</small>
        </div>
      </ScrollOrbit>
    </StudyShell>
  );
}
