import { HomeCta } from "../components/home-cta";
import { Reveal } from "../components/home-motion";
import { StudyShell } from "../components/study-shell";
import { getStudy, LOGIN_HREF, SIGNUP_HREF } from "../home-data";

export function ConversionStudy() {
  const study = getStudy("workspace");

  return (
    <StudyShell study={study} className="home-conversion">
      <div className="home-conversion__signal" aria-hidden="true">
        <span>05</span>
        <span className="home-conversion__disc" />
      </div>

      <div className="home-conversion__copy">
        <Reveal>
          <p className="home-kicker">The loop becomes a workspace.</p>
        </Reveal>
        <h2 id="workspace-title" className="home-display home-conversion__title">
          <Reveal className="home-display__line">Build the week.</Reveal>
          <Reveal className="home-display__line" delay={0.06}>
            Run the day.
          </Reveal>
          <Reveal className="home-display__line home-display__line--signal" delay={0.12}>
            Review the system.
          </Reveal>
        </h2>
        <Reveal delay={0.16}>
          <p className="home-lead">{study.description}</p>
        </Reveal>
        <Reveal className="home-conversion__actions" delay={0.2}>
          <HomeCta href={SIGNUP_HREF} tone="signal">
            Create your account
          </HomeCta>
          <HomeCta href={LOGIN_HREF} tone="secondary">
            Enter workspace
          </HomeCta>
        </Reveal>
        <p className="home-conversion__note">Goals · Tasks · Focus · Review · One connected operating loop</p>
      </div>
    </StudyShell>
  );
}
