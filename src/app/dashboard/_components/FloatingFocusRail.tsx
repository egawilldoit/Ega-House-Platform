import Link from "next/link";

export function FloatingFocusRail() {
  return (
    <div className="dashboard-floating-rail" role="navigation" aria-label="Quick actions">
      {/* Timer */}
      <Link href="/timer" id="rail-timer" className="dashboard-rail-btn dashboard-rail-btn-active">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Timer
      </Link>

      {/* Tasks */}
      <Link href="/tasks" id="rail-tasks" className="dashboard-rail-btn">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        Tasks
      </Link>

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: "1.25rem",
          background: "#e4e7ec",
          margin: "0 0.125rem",
        }}
        aria-hidden="true"
      />

      {/* Review */}
      <Link href="/review" id="rail-review" className="dashboard-rail-btn">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
        Review
      </Link>

      {/* Goals */}
      <Link href="/goals" id="rail-goals" className="dashboard-rail-btn">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
        Goals
      </Link>
    </div>
  );
}
