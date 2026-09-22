"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { TrendBarChart } from "@/components/review/trend-bar-chart";
import {
  AllocationDonut,
  FocusTrendChart,
  type AllocationSegment,
} from "@/components/work-analytics/analytics-charts";
import { formatDurationLabel } from "@/lib/task-session";
import {
  AnalyticsDrilldownProvider,
  useAnalyticsDrilldown,
} from "./analytics-drilldown-context";
import { AnalyticsDrilldownDrawer } from "./analytics-drilldown-drawer";

import {
  collectDrilldownSessionsForBucket,
  type WorkAnalyticsDaily,
  type WorkAnalyticsProjectBreakdown,
  type WorkAnalyticsGoalBreakdown,
  type WorkAnalyticsTaskBreakdown,
  type DrilldownSessionDTO,
  type DrilldownIndexes,
} from "@/lib/services/work-analytics-service";

type AnalyticsGroupBy = "day" | "week" | "month";

const RECENT_SESSION_LIMIT = 8;

// ---- Bucket helpers -------------------------------------------------------

/** Exact-date rows behind a grouped chart bucket, resolved by the canonical owner. */
function sessionsForBucket(
  dateIndex: Record<string, DrilldownSessionDTO[]>,
  bucketDate: string,
  groupBy: AnalyticsGroupBy,
) {
  return collectDrilldownSessionsForBucket(bucketDate, groupBy, dateIndex).sort(
    (left, right) => left.startedAt.localeCompare(right.startedAt),
  );
}

function allIndexedSessions(dateIndex: Record<string, DrilldownSessionDTO[]>) {
  const seen = new Set<string>();
  const sessions: DrilldownSessionDTO[] = [];

  for (const bucket of Object.values(dateIndex)) {
    for (const session of bucket) {
      const key = `${session.taskId}:${session.startedAt}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      sessions.push(session);
    }
  }

  return sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatSessionTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- Panels ---------------------------------------------------------------

type AnalyticsPanelProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
};

function AnalyticsPanel({
  title,
  description,
  action,
  bodyClassName,
  children,
}: AnalyticsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {action ? <CardAction>{action}</CardAction> : null}
        </div>
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  );
}

function RecentSessionsTable({
  dateIndex,
  selectedRangeLabel,
}: {
  dateIndex: Record<string, DrilldownSessionDTO[]>;
  selectedRangeLabel: string;
}) {
  const { openDrilldown } = useAnalyticsDrilldown();
  const sessions = allIndexedSessions(dateIndex).slice(0, RECENT_SESSION_LIMIT);

  const openAll = () => {
    openDrilldown({
      type: "date",
      label: selectedRangeLabel,
      sessions: allIndexedSessions(dateIndex),
    });
  };

  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="py-4 text-center text-[length:var(--text-meta-lg)] text-ega-text-secondary">
            No sessions recorded in the selected range yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card flush>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Recent focus sessions</CardTitle>
            <CardDescription className="mt-1">
              Most recent sessions in {selectedRangeLabel}. Select a row to open the full list.
            </CardDescription>
          </div>
          <CardAction>
            <button
              type="button"
              onClick={openAll}
              className="text-[length:var(--text-meta-lg)] font-medium text-ega-text-secondary hover:text-ega-text"
            >
              View all
            </button>
          </CardAction>
        </div>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="hidden sm:table-cell">
                Date
              </th>
              <th scope="col">Time</th>
              <th scope="col" className="hidden md:table-cell">
                Project
              </th>
              <th scope="col">Task</th>
              <th scope="col" className="text-right">
                Duration
              </th>
              <th scope="col" className="hidden sm:table-cell">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={`${session.taskId}-${session.startedAt}`}>
                <td className="hidden whitespace-nowrap tabular-nums text-ega-text-secondary sm:table-cell">
                  {formatSessionDate(session.startedAt)}
                </td>
                <td className="whitespace-nowrap tabular-nums text-ega-text-secondary">
                  {formatSessionTime(session.startedAt)}
                  {session.endedAt ? ` – ${formatSessionTime(session.endedAt)}` : ""}
                </td>
                <td className="hidden max-w-[12rem] truncate md:table-cell">
                  {session.projectName ?? "—"}
                </td>
                <td className="max-w-[16rem] truncate font-medium">{session.taskTitle}</td>
                <td className="whitespace-nowrap text-right tabular-nums">
                  {formatDurationLabel(session.durationSeconds)}
                </td>
                <td className="hidden sm:table-cell">
                  {session.endedAt ? (
                    <Badge tone="muted">Ended</Badge>
                  ) : (
                    <StatusBadge status="in_progress" label="Still running" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Breakdown allocation -------------------------------------------------

type BreakdownCardProps = {
  title: string;
  breakdownBy: string;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  projectDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  goalDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  taskDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  selectedRangeLabel: string;
};

function BreakdownAllocation({
  title,
  breakdownBy,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  projectDrilldownIndex,
  goalDrilldownIndex,
  taskDrilldownIndex,
  selectedRangeLabel,
}: BreakdownCardProps) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const segments: AllocationSegment[] =
    breakdownBy === "goal"
      ? goalBreakdown.map((entry) => ({
          key: entry.goalId ?? "__no-goal__",
          label: entry.goalTitle,
          value: entry.workedMinutes,
          detail: formatDurationLabel(entry.workedMinutes * 60),
          onSelect: () =>
            openDrilldown({
              type: "goal",
              label: entry.goalTitle,
              sessions: goalDrilldownIndex[entry.goalId ?? "__no-goal__"] ?? [],
            }),
        }))
      : breakdownBy === "task"
        ? taskBreakdown.map((entry) => ({
            key: entry.taskId,
            label: entry.taskTitle,
            value: entry.workedMinutes,
            detail: formatDurationLabel(entry.workedMinutes * 60),
            onSelect: () =>
              openDrilldown({
                type: "task",
                label: entry.taskTitle,
                sessions: taskDrilldownIndex[entry.taskId] ?? [],
              }),
          }))
        : projectBreakdown.map((entry) => ({
            key: entry.projectId ?? "__unknown__",
            label: entry.projectName,
            value: entry.workedMinutes,
            detail: formatDurationLabel(entry.workedMinutes * 60),
            onSelect: () =>
              openDrilldown({
                type: "project",
                label: entry.projectName,
                sessions: projectDrilldownIndex[entry.projectId ?? "__unknown__"] ?? [],
              }),
          }));

  const totalMinutes = segments.reduce((sum, segment) => sum + segment.value, 0);

  const dimension =
    breakdownBy === "goal" ? "goal" : breakdownBy === "task" ? "task" : "project";

  return (
    <AnalyticsPanel
      title={title}
      description={`Focused time by ${dimension} for ${selectedRangeLabel}. Select an entry to open its sessions.`}
    >
      <AllocationDonut
        segments={segments}
        totalLabel={formatDurationLabel(totalMinutes * 60)}
        ariaLabel={`Focused time allocation by ${dimension}`}
        emptyMessage={`No tracked time by ${dimension} in this range yet.`}
      />
    </AnalyticsPanel>
  );
}

// ---- Main interactive wrapper ---------------------------------------------

type InteractiveAnalyticsProps = {
  drilldownIndexes: DrilldownIndexes;
  recentDateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  trendDateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  primarySeries: WorkAnalyticsDaily[];
  primaryTitle: string;
  last7DaysSeries: WorkAnalyticsDaily[];
  last30DaysSeries: WorkAnalyticsDaily[];
  breakdownBy: string;
  breakdownTitle: string;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  selectedRangeLabel: string;
  groupBy: AnalyticsGroupBy;
  children?: React.ReactNode;
};

export function InteractiveAnalytics({
  drilldownIndexes,
  recentDateDrilldownIndex,
  trendDateDrilldownIndex,
  primarySeries,
  primaryTitle,
  last7DaysSeries,
  last30DaysSeries,
  breakdownBy,
  breakdownTitle,
  projectBreakdown,
  goalBreakdown,
  taskBreakdown,
  selectedRangeLabel,
  groupBy,
  children,
}: InteractiveAnalyticsProps) {
  return (
    <AnalyticsDrilldownProvider>
      <div className="flex flex-col gap-6">
        <div data-testid="analytics-primary-chart">
          <AnalyticsSection
            primarySeries={primarySeries}
            primaryTitle={primaryTitle}
            dateDrilldownIndex={drilldownIndexes.date}
            groupBy={groupBy}
            selectedRangeLabel={selectedRangeLabel}
          />
        </div>

        <DashboardSection
          title="Rhythm and allocation"
          description="Short-term rhythm, where focused time went, and the 30-day trend."
        >
          <div className="grid gap-4 lg:grid-cols-3" data-testid="analytics-secondary-grid">
            <AnalyticsPanel
              title="Weekly rhythm"
              description="Focused time for each of the last 7 days."
            >
              <WeeklyRhythm
                series={last7DaysSeries}
                dateDrilldownIndex={recentDateDrilldownIndex}
                groupBy="day"
              />
            </AnalyticsPanel>

            <BreakdownAllocation
              title={breakdownTitle}
              breakdownBy={breakdownBy}
              projectBreakdown={projectBreakdown}
              goalBreakdown={goalBreakdown}
              taskBreakdown={taskBreakdown}
              projectDrilldownIndex={drilldownIndexes.project}
              goalDrilldownIndex={drilldownIndexes.goal}
              taskDrilldownIndex={drilldownIndexes.task}
              selectedRangeLabel={selectedRangeLabel}
            />

            <FocusTrendPanel
              series={last30DaysSeries}
              dateDrilldownIndex={trendDateDrilldownIndex}
              groupBy="day"
            />
          </div>
        </DashboardSection>

        {children}

        <DashboardSection
          title="Recent activity"
          description="The sessions behind the selected range's totals."
        >
          <RecentSessionsTable
            dateIndex={drilldownIndexes.date}
            selectedRangeLabel={selectedRangeLabel}
          />
        </DashboardSection>
      </div>
      <AnalyticsDrilldownDrawer />
    </AnalyticsDrilldownProvider>
  );
}

// ---- Date-bucket drilldown -------------------------------------------------

type OpenDrilldown = (data: {
  type: "date";
  label: string;
  sessions: DrilldownSessionDTO[];
}) => void;

function openBucketDrilldown(
  openDrilldown: OpenDrilldown,
  dateIndex: Record<string, DrilldownSessionDTO[]>,
  date: string,
  groupBy: AnalyticsGroupBy,
  label: string,
) {
  openDrilldown({
    type: "date",
    label,
    sessions: sessionsForBucket(dateIndex, date, groupBy),
  });
}

function AnalyticsSection({
  primarySeries,
  primaryTitle,
  dateDrilldownIndex,
  groupBy,
  selectedRangeLabel,
}: {
  primarySeries: WorkAnalyticsDaily[];
  primaryTitle: string;
  dateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  groupBy: AnalyticsGroupBy;
  selectedRangeLabel: string;
}) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleBucketClick = React.useCallback(
    (date: string, label: string) => {
      openBucketDrilldown(openDrilldown, dateDrilldownIndex, date, groupBy, label);
    },
    [dateDrilldownIndex, groupBy, openDrilldown],
  );

  return (
    <DashboardSection
      title="Focused time over time"
      description={`Focused time per ${groupBy} for ${selectedRangeLabel}. Select a point to open its sessions.`}
    >
      <AnalyticsPanel
        title={primaryTitle}
        description="Bars are tracked focus; the line follows the same daily values."
        action={<Badge tone="muted">{selectedRangeLabel}</Badge>}
      >
        <FocusTrendChart
          data={primarySeries}
          variant="bars"
          showTrendLine
          height={260}
          ariaLabel={`Focused time per ${groupBy} for ${selectedRangeLabel}`}
          tableCaption={`Focused time per ${groupBy} for ${selectedRangeLabel}`}
          onBucketClick={handleBucketClick}
        />
      </AnalyticsPanel>
    </DashboardSection>
  );
}

function WeeklyRhythm({
  series,
  dateDrilldownIndex,
  groupBy,
}: {
  series: WorkAnalyticsDaily[];
  dateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  groupBy: AnalyticsGroupBy;
}) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handleBarClick = React.useCallback(
    (date: string, label: string) => {
      openBucketDrilldown(openDrilldown, dateDrilldownIndex, date, groupBy, label);
    },
    [dateDrilldownIndex, groupBy, openDrilldown],
  );

  return (
    <TrendBarChart data={series} title="Weekly rhythm" onBarClick={handleBarClick} />
  );
}

function FocusTrendPanel({
  series,
  dateDrilldownIndex,
  groupBy,
}: {
  series: WorkAnalyticsDaily[];
  dateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  groupBy: AnalyticsGroupBy;
}) {
  const { openDrilldown } = useAnalyticsDrilldown();

  const handlePointClick = React.useCallback(
    (date: string, label: string) => {
      openBucketDrilldown(openDrilldown, dateDrilldownIndex, date, groupBy, label);
    },
    [dateDrilldownIndex, groupBy, openDrilldown],
  );

  return (
    <AnalyticsPanel
      title="Focus trend"
      description="Daily focused time across the last 30 days."
    >
      <FocusTrendChart
        data={series}
        variant="line"
        ariaLabel="Focused time per day across the last 30 days"
        tableCaption="Focused time per day across the last 30 days"
        onBucketClick={handlePointClick}
      />
    </AnalyticsPanel>
  );
}
