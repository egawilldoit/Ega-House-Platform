import { AnimatedRule } from "../components/animated-rule";
import { Reveal } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy } from "../home-data";

const hierarchy = [
  {
    index: "01",
    label: "Strategic objective",
    value: "Ship the EGA operating loop",
    state: "ACTIVE",
  },
  {
    index: "02",
    label: "Current milestone",
    value: "Make daily execution observable",
    state: "NOW",
  },
  {
    index: "03",
    label: "Next action",
    value: "Close the homepage delivery slice",
    state: "NEXT",
  },
] as const;

export function GoalsStudy() {
  const study = getStudy("goals");

  return (
    <StudyShell study={study} className="home-goals">
      <div className="home-study-copy">
        <Reveal>
          <p className="home-kicker">Direction before activity.</p>
        </Reveal>
        <h2 id="goals-title" className="home-display home-goals__title">
          <Reveal className="home-display__line home-display__line--serif">Quiet</Reveal>
          <Reveal className="home-display__line home-display__line--serif" delay={0.06}>
            structure.
          </Reveal>
          <Reveal className="home-display__line" delay={0.12}>
            Loud intent.
          </Reveal>
        </h2>
        <Reveal delay={0.16}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <AnimatedRule />
      </div>

      <Reveal className="home-goal-board" delay={0.08}>
        <div className="home-goal-board__head">
          <div>
            <span className="home-interface-label">Today</span>
            <strong>Goal hierarchy</strong>
          </div>
          <span>01 / Goals</span>
        </div>
        <ol className="home-goal-list">
          {hierarchy.map((item, index) => (
            <li key={item.index} className={index === 1 ? "is-current" : undefined}>
              <span className="home-goal-list__index">{item.index}</span>
              <span className="home-goal-list__body">
                <small>{item.label}</small>
                <strong>{item.value}</strong>
              </span>
              <span className="home-goal-list__state">{item.state}</span>
            </li>
          ))}
        </ol>
        <div className="home-goal-board__foot">
          <span>1 objective</span>
          <span>3 linked layers</span>
          <span>Context preserved</span>
        </div>
      </Reveal>
    </StudyShell>
  );
}
