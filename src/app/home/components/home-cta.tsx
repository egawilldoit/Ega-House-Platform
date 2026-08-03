import Link from "next/link";

type HomeCtaProps = {
  href: string;
  children: React.ReactNode;
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
