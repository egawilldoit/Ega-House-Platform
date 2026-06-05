import Link from "next/link";

import { Clock3, Clock as ClockIcon, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { formatIsoDate } from "@/lib/review-week";
import { formatTimerDateTime } from "@/lib/timer-domain";

import { toPreviewText } from "../_lib/dashboard-helpers";
import type { DashboardData } from "../_lib/dashboard-data";

interface ReviewPulseCardProps {
  review: DashboardData["latestReview"];
  goals: DashboardData["goals"];
  health: DashboardData["health"];
}

export function ReviewPulseCard({ review, goals, health }: ReviewPulseCardProps) {
  const goalItems = goals.data ?? [];
  const latestReviewItem = review.data;

  return (
    <Card className="border-transparent bg-[color:var(--instrument)]">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="glass-label text-[color:var(--signal-live)]">Review Pulse</p>
            <CardTitle className="mt-2 text-xl">
              {latestReviewItem ? "Latest weekly review" : "Review memory is empty"}
            </CardTitle>
            <CardDescription>
              The newest review entry anchors the dashboard narrative alongside live system state.
            </CardDescription>
          </div>
          <CardAction>
            <Link href="/review" className="glass-label text-signal-live">
              Open review
            </Link>
          </CardAction>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {review.error ? (
          <div className="feedback-block feedback-block-error">{review.error}</div>
        ) : latestReviewItem ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info" className="rounded-full px-3 shadow-sm">
                {formatIsoDate(latestReviewItem.weekStart)} - {formatIsoDate(latestReviewItem.weekEnd)}
              </Badge>
              <Badge tone="muted" className="rounded-full px-3 shadow-sm">
                Updated {formatTimerDateTime(latestReviewItem.updatedAt)}
              </Badge>
            </div>
            <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
              {toPreviewText(latestReviewItem.summary, 220)}
            </p>
          </>
        ) : (
          <EmptyState
            icon={Clock3}
            title="Review memory is empty"
            description="Save a weekly reflection and it will appear here as the dashboard narrative anchor."
            actionLabel="Open review"
            actionHref="/review"
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="Goals Visible"
            value={String(goalItems.length)}
            subtitle={goalItems.length > 0 ? "Existing goals pulled in from workspace" : "No goals yet"}
            icon={Target}
          />
          <StatCard
            label="Latest Check"
            value={formatTimerDateTime(health.checkedAt)}
            subtitle="OpenClaw health probe timestamp"
            icon={ClockIcon}
          />
        </div>
      </CardContent>
    </Card>
  );
}
