import type { HomeStudy } from "../home.types";

type StudyLabelProps = {
  study: HomeStudy;
};

export function StudyLabel({ study }: StudyLabelProps) {
  return (
    <div className="home-study-label" aria-label={`${study.title} study metadata`}>
      <span>STUDY {study.index}</span>
      <span>{study.discipline}</span>
      <span>{study.artDirection}</span>
    </div>
  );
}
