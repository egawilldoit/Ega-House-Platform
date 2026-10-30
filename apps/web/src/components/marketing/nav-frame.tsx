"use client";

import { useEffect, useRef, type ReactNode } from "react";

type NavFrameProps = {
  className: string;
  children: ReactNode;
};

export function NavFrame({ className, children }: NavFrameProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;

    let frame = 0;

    const sync = () => {
      frame = 0;
      if (window.scrollY > 8) {
        header.setAttribute("data-scrolled", "true");
      } else {
        header.removeAttribute("data-scrolled");
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener("scroll", schedule, { passive: true });

    return () => {
      window.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header ref={ref} className={className}>
      {children}
    </header>
  );
}
