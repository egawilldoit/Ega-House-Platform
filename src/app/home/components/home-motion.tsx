"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MotionConfig,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

import { HOME_STUDIES } from "../home-data";
import type { HomeStudy } from "../home.types";

type HomeMotionContextValue = {
  activeId: HomeStudy["id"];
  activeIndex: number;
};

const HomeMotionContext = createContext<HomeMotionContextValue>({
  activeId: "intro",
  activeIndex: 0,
});

export function useHomeMotion(): HomeMotionContextValue {
  return useContext(HomeMotionContext);
}

type HomeMotionProps = {
  children: ReactNode;
};

export function HomeMotion({ children }: HomeMotionProps) {
  const [activeId, setActiveId] = useState<HomeStudy["id"]>("intro");
  const ratiosRef = useRef(new Map<HomeStudy["id"], number>());
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 150,
    damping: 28,
    mass: 0.22,
  });

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-home-study]"),
    );

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-home-study") as HomeStudy["id"] | null;
          if (id) {
            ratiosRef.current.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
          }
        }

        const next = [...ratiosRef.current.entries()].sort((a, b) => b[1] - a[1])[0];
        if (next && next[1] > 0) {
          setActiveId(next[0]);
        }
      },
      {
        rootMargin: "-18% 0px -42% 0px",
        threshold: [0, 0.2, 0.35, 0.5, 0.7],
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, []);

  const activeIndex = useMemo(
    () => Math.max(0, HOME_STUDIES.findIndex((study) => study.id === activeId)),
    [activeId],
  );

  return (
    <MotionConfig reducedMotion="user">
      <HomeMotionContext.Provider value={{ activeId, activeIndex }}>
        <motion.div
          aria-hidden="true"
          className="home-scroll-progress"
          style={{ scaleX: smoothProgress }}
        />
        {children}
      </HomeMotionContext.Provider>
    </MotionConfig>
  );
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={false}
      transition={{ duration: 0.62, delay, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, amount: 0.28 }}
      whileInView={
        reduceMotion
          ? undefined
          : {
              opacity: [0.76, 1],
              y: [18, 0],
            }
      }
    >
      {children}
    </motion.div>
  );
}

type AnimatedRuleProps = {
  className?: string;
};

export function AnimatedRuleMotion({ className }: AnimatedRuleProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden="true"
      className={className ? `home-animated-rule ${className}` : "home-animated-rule"}
      initial={false}
      style={{ transformOrigin: "left center" }}
      transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, amount: 0.6 }}
      whileInView={reduceMotion ? undefined : { scaleX: [0.18, 1] }}
    />
  );
}

type BarRevealProps = {
  className?: string;
  children?: ReactNode;
};

export function BarReveal({ className, children }: BarRevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={false}
      style={{ transformOrigin: "bottom center" }}
      transition={{ duration: 0.76, ease: [0.22, 1, 0.36, 1] }}
      viewport={{ once: true, amount: 0.4 }}
      whileInView={reduceMotion ? undefined : { scaleY: [0.16, 1] }}
    >
      {children}
    </motion.div>
  );
}

type ScrollOrbitProps = {
  children: ReactNode;
  className?: string;
};

export function ScrollOrbit({ children, className }: ScrollOrbitProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start end", "end start"],
  });
  const rotate = useTransform(scrollYProgress, [0, 1], [-7, 7]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.96, 1.025, 0.98]);

  return (
    <motion.div
      ref={targetRef}
      className={className}
      style={reduceMotion ? undefined : { rotate, scale }}
    >
      {children}
    </motion.div>
  );
}
