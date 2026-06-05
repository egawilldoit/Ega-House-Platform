export function HeroSkeleton() {
  return (
    <div className="ega-dashboard-hero ega-dashboard-hero-compact" aria-hidden>
      <div className="ega-dashboard-hero-copy relative overflow-hidden">
        <div className="ega-glass animate-pulse h-40 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="ega-glass animate-pulse h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function CommandCenterSkeleton() {
  return (
    <div className="ega-glass animate-pulse h-72 rounded-xl" aria-hidden />
  );
}

export function PlannerSkeleton() {
  return (
    <div className="ega-glass animate-pulse rounded-xl p-6 space-y-3" aria-hidden>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-16 bg-[var(--muted)] rounded-lg" />
      ))}
    </div>
  );
}

export function FocusSkeleton() {
  return (
    <div className="ega-glass animate-pulse h-48 rounded-xl" aria-hidden />
  );
}

export function GoalsSkeleton() {
  return (
    <div className="ega-glass animate-pulse h-32 rounded-xl" aria-hidden />
  );
}

export function ProjectsSkeleton() {
  return (
    <div className="ega-glass animate-pulse rounded-xl p-6 space-y-3" aria-hidden>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-10 bg-[var(--muted)] rounded-lg" />
      ))}
    </div>
  );
}

export function ReviewPulseSkeleton() {
  return (
    <div className="ega-glass animate-pulse h-64 rounded-xl" aria-hidden />
  );
}

export function TimerSummarySkeleton() {
  return (
    <div className="ega-glass animate-pulse h-40 rounded-xl" aria-hidden />
  );
}
