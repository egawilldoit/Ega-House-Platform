export type HomeTheme =
  | "signal"
  | "sea-glass"
  | "terracotta"
  | "citrus"
  | "review"
  | "conversion";

export type HomeStudy = {
  id: "intro" | "goals" | "planning" | "focus" | "review" | "workspace";
  index: string;
  discipline: string;
  artDirection: string;
  theme: HomeTheme;
  title: string;
  headline: string;
  description: string;
};
