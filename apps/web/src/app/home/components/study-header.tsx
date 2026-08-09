"use client";

import Link from "next/link";

import { HOME_STUDIES, LOGIN_HREF } from "../home-data";
import { useHomeMotion } from "./home-motion";

export function StudyHeader() {
  const { activeIndex } = useHomeMotion();
  const study = HOME_STUDIES[activeIndex] ?? HOME_STUDIES[0];

  return (
    <header className="home-study-header">
      <Link className="home-study-header__brand" href="#intro" aria-label="EGA House homepage">
        EGA HOUSE
      </Link>

      <p className="home-study-header__status" aria-live="polite">
        <span>{study.index} / 05</span>
        <span aria-hidden="true">·</span>
        <span>{study.title}</span>
      </p>

      <Link className="home-study-header__action" href={LOGIN_HREF}>
        Enter workspace <span aria-hidden="true">↓</span>
      </Link>
    </header>
  );
}
