import type { ReactNode } from "react";

import type { HomeStudy } from "../home.types";
import { StudyLabel } from "./study-label";

type StudyShellProps = {
  study: HomeStudy;
  children: ReactNode;
  className?: string;
};

export function StudyShell({ study, children, className }: StudyShellProps) {
  const classes = className ? `home-study ${className}` : "home-study";

  return (
    <section
      id={study.id}
      data-home-study={study.id}
      data-theme={study.theme}
      className={classes}
      aria-labelledby={`${study.id}-title`}
    >
      <StudyLabel study={study} />
      <div className="home-study__content">{children}</div>
    </section>
  );
}
