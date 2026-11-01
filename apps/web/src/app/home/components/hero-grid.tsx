"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function HeroGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      !matchMedia("(hover: hover)").matches ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--home-mx", `${event.clientX - rect.left}px`);
      el.style.setProperty("--home-my", `${event.clientY - rect.top}px`);
    };

    el.addEventListener("pointermove", onPointerMove);
    return () => el.removeEventListener("pointermove", onPointerMove);
  }, []);

  return (
    <section ref={ref} id="top" className="home-hero">
      {children}
    </section>
  );
}
