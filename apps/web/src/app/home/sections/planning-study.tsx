import { AnimatedRule } from "../components/animated-rule";
import { BarReveal, Reveal } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy } from "../home-data";

const bars = [
  ["M", "home-plan-bar--one"],
  ["T", "home-plan-bar--two"],
  ["W", "home-plan-bar--three"],
  ["T", "home-plan-bar--four"],
  ["F", "home-plan-bar--five"],
  ["S", "home-plan-bar--six"],
] as const;

export function PlanningStudy() {
  const study = getStudy("planning");

  return (
    <StudyShell study={study} className="home-planning">
      <div className="home-study-copy">
        <Reveal>
          <p className="home-kicker">A plan that earns its place.</p>
        </Reveal>
        <h2 id="planning-title" className="home-display home-planning__title">
          <Reveal className="home-display__line">Move the plan</Reveal>
          <Reveal className="home-display__line" delay={0.06}>
            into motion.
          </Reveal>
          <Reveal className="home-display__line home-display__line--compact" delay={0.12}>
            Without the noise.
          </Reveal>
        </h2>
        <Reveal delay={0.16}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <AnimatedRule />
      </div>

      <Reveal className="home-plan-board" delay={0.08}>
        <div className="home-plan-board__head">
          <div>
            <span className="home-interface-label">Live plan</span>
            <strong>Execution load</strong>
          </div>
          <span>Updated now</span>
        </div>

        <div className="home-plan-chart" role="img" aria-label="Six day workload distribution">
          {bars.map(([day, modifier]) => (
            <div className="home-plan-chart__column" key={`${day}-${modifier}`}>
              <BarReveal className={`home-plan-bar ${modifier}`} />
              <span>{day}</span>
            </div>
          ))}
        </div>

        <dl className="home-plan-metrics">
          <div>
            <dt>Linked work</dt>
            <dd>18</dd>
          </div>
          <div>
            <dt>Execution ratio</dt>
            <dd>72%</dd>
          </div>
          <div>
            <dt>Planning horizon</dt>
            <dd>7d</dd>
          </div>
        </dl>
      </Reveal>
    </StudyShell>
  );
}
