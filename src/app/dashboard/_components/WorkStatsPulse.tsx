import Link from "next/link";
import { ClockIcon } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";
import { calculateWorkAnalytics, calculateWorkAnalyticsInsights, getCurrentWeekWindow, getTodayWindow } from "@/lib/services/work-analytics-service";
import { formatDurationLabel } from "@/lib/task-session";

export default async function WorkStatsPulse() {
  const user = await getCurrentUser();
  if (!user) return <StatCard label="Worked today" value="--" subtitle="Sign in required" icon={ClockIcon} />;
  const supabase = await createClient();
  const now = new Date();
  const todayWindow = getTodayWindow(now);
  const weekWindow = getCurrentWeekWindow(now);
  const sessionsResult = await getWorkAnalyticsSessionsForWindow({ ownerUserId: user.id, window: weekWindow, supabase });
  if (sessionsResult.errorMessage || !sessionsResult.data) return <StatCard label="Worked today" value="--" subtitle="Analytics unavailable" icon={ClockIcon} />;
  const sessions = sessionsResult.data;
  const today = calculateWorkAnalytics(sessions, todayWindow, { nowIso: now.toISOString() });
  const week = calculateWorkAnalyticsInsights(sessions, weekWindow, { nowIso: now.toISOString() });
  return (
    <Link href="/work-analytics" className="block">
      <StatCard
        label="Worked today"
        value={formatDurationLabel(today.totalWorkedMinutes * 60)}
        subtitle={`${today.sessionCount} sessions · ${week.currentStreak} day streak`}
        icon={ClockIcon}
      />
    </Link>
  );
}
