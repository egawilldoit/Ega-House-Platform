import { AnimatedRule } from "../components/animated-rule";
import { Reveal } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy } from "../home-data";

const reviewRows = [
  ["01", "Completed", "Homepage direction approved and bounded", "EVIDENCE"],
  ["02", "Unresolved", "Mobile motion still needs device validation", "OPEN"],
  ["03", "Lesson", "One visual system beats a stack of unrelated effects", "KEEP"],
  ["04", "Correction", "Promote accepted patterns into shared primitives", "NEXT"],
] as const;

export function ReviewStudy() {
  const study = getStudy("review");

  return (
    <StudyShell study={study} className="home-review">
      <div className="home-review__heading">
        <Reveal>
          <p className="home-kicker">Reflection with operational consequence.</p>
        </Reveal>
        <h2 id="review-title" className="home-display home-review__title">
          <Reveal className="home-display__line">Review the evidence.</Reveal>
          <Reveal className="home-display__line home-display__line--signal" delay={0.08}>
            Correct the system.
          </Reveal>
        </h2>
        <Reveal delay={0.14}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <AnimatedRule />
      </div>

      <ol className="home-review-list">
        {reviewRows.map(([index, label, value, state], rowIndex) => (
          <Reveal key={index} delay={rowIndex * 0.045}>
            <li className={state === "NEXT" ? "is-correction" : undefined}>
              <span className="home-review-list__index">{index}</span>
              <span className="home-review-list__label">{label}</span>
              <strong>{value}</strong>
              <span className="home-review-list__state">{state}</span>
            </li>
          </Reveal>
        ))}
      </ol>
    </StudyShell>
  );
}
