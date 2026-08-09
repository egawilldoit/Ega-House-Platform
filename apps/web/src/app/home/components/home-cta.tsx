import Link from "next/link";
import type { ReactNode } from "react";

type HomeCtaProps = {
  href: string;
  children: ReactNode;
  tone?: "primary" | "secondary" | "signal";
};

export function HomeCta({ href, children, tone = "primary" }: HomeCtaProps) {
  return (
    <Link className={`home-cta home-cta--${tone}`} href={href}>
      <span>{children}</span>
      <span aria-hidden="true">↗</span>
    </Link>
  );
}
