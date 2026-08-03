import { AnimatedRule } from "../components/animated-rule";
import { HomeCta } from "../components/home-cta";
import { Reveal } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy, LOGIN_HREF, SIGNUP_HREF } from "../home-data";

const operations = [
  ["01", "Goals", "Set the direction"],
  ["02", "Planning", "Shape the work"],
  ["03", "Focus", "Run the session"],
  ["04", "Review", "Correct the system"],
] as const;

export function HeroStudy() {
  const study = getStudy("intro");

  return (
    <StudyShell study={study} className="home-hero">
      <div className="home-hero__signal" aria-hidden="true">
        <Reveal className="home-hero__signal-word">
          <span>EGA</span>
        </Reveal>
        <span className="home-hero__signal-number">00</span>
        <span className="home-orbit home-orbit--one" />
        <span className="home-orbit home-orbit--two" />
      </div>

      <div className="home-hero__copy">
        <Reveal>
          <p className="home-kicker">A personal operating system with a point of view.</p>
        </Reveal>
        <h1 id="intro-title" className="home-display home-hero__title">
          <Reveal className="home-display__line">One operating system</Reveal>
          <Reveal className="home-display__line" delay={0.06}>
            for turning intention
          </Reveal>
          <Reveal className="home-display__line home-display__line--signal" delay={0.12}>
            into execution.
          </Reveal>
        </h1>
        <Reveal delay={0.16}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <Reveal className="home-hero__actions" delay={0.2}>
          <HomeCta href={LOGIN_HREF}>Enter workspace</HomeCta>
          <HomeCta href={SIGNUP_HREF} tone="secondary">
            Create account
          </HomeCta>
        </Reveal>
        <AnimatedRule />
        <ol className="home-operation-index" aria-label="EGA House operating loop">
          {operations.map(([index, title, detail]) => (
            <li key={index}>
              <span>{index}</span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </li>
          ))}
        </ol>
      </div>
    </StudyShell>
  );
}
