import type { CSSProperties } from "react";

type Word = { text: string; weight: number };

export function WeightRamp({
  lines,
  as: Tag = "h1",
}: {
  lines: Word[][];
  as?: "h1" | "h2";
}) {
  const label = lines
    .flat()
    .map((w) => w.text)
    .join(" ");
  let i = 0;

  return (
    <Tag className="home-ramp" aria-label={label}>
      {lines.map((line, l) => (
        <span key={l} className="home-ramp__line" aria-hidden="true">
          {line.map((w, k) => (
            <span key={w.text}>
              {k > 0 ? " " : null}
              <span
                className="home-ramp__word"
                style={{ "--w": w.weight, "--i": i++ } as CSSProperties}
              >
                {w.text}
              </span>
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
