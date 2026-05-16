import {
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
  calculateExecutionEvidenceForWindow,
  getExecutionEvidenceSessionOverlapSeconds,
} from './execution-evidence-service';
import { getCurrentDayWindow } from '@/lib/task-session';

/**
 * Get the window for today (start of day to now)
 */
export function getTodayWindow(now = new Date()): ExecutionEvidenceWindow {
  const dayWindow = getCurrentDayWindow(now);
  return {
    startIso: dayWindow.startIso,
    endIso: dayWindow.endIso,
  };
}

/**
 * Get the window for the current week (Monday start of week to now)
 * Uses local date handling consistent with existing app date utilities
 */
export function getCurrentWeekWindow(now = new Date()): ExecutionEvidenceWindow {
  const monday = new Date(now);
  // Set to Monday of this week (0 = Sunday, 1 = Monday, etc.)
  const day = monday.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day; // Adjust for Sunday
  monday.setDate(monday.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  return {
    startIso: monday.toISOString(),
    endIso: now.toISOString(),
  };
}

export type WorkAnalyticsPeriod = {
  totalWorkedMinutes: number;
  sessionCount: number;
  completedTaskCount?: number; // undefined if not computed
};

export type WorkAnalyticsOptions = {
  nowIso?: string;
  includeOpenSessions?: boolean; // default false for completed sessions only
};

/**
 * Aggregates work analytics for a given time window.
 * @param sessions Raw session data from task_sessions table (with tasks relation)
 * @param window Start and end of the period to analyze (in ISO strings)
 * @param options Optional configuration (now for mocking, includeOpenSessions)
 * @returns Period totals for worked time and session count
 */
export function calculateWorkAnalytics(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: WorkAnalyticsOptions = {}
): WorkAnalyticsPeriod {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const includeOpenSessions = options.includeOpenSessions ?? false;

  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso,
    includeOpenSessions,
  });

  return {
    totalWorkedMinutes: Math.floor(evidence.totalTrackedSeconds / 60),
    sessionCount: evidence.sessionCount,
    completedTaskCount: undefined,
  };
}

/**
 * Represents a single day's work analytics
 */
export type WorkAnalyticsDaily = {
  date: string; // ISO date string (YYYY-MM-DD)
  workedMinutes: number;
  sessionCount: number;
  completedTaskCount?: number; // undefined if not computed
};

export type WorkAnalyticsProjectBreakdown = {
  projectId: string | null;
  projectName: string;
  workedMinutes: number;
  sessionCount: number;
};

export type WorkAnalyticsWithBreakdown = {
  period: WorkAnalyticsPeriod;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
};

export type WorkAnalyticsInsights = {
  // Period comparison
  previousPeriodWorkedMinutes: number;
  deltaMinutes: number;
  percentChange: number | null; // null when no previous period
  
  // Best/worst days
  bestDay: WorkAnalyticsDaily | null; // null when no data
  lowestNonZeroDay: WorkAnalyticsDaily | null; // null when no data or all zero
  daysWorkedCount: number; // number of days with >0 worked minutes
  currentStreak: number; // consecutive days with work up to today
  
  // Session quality
  averageSessionLength: number; // minutes
  longestSession: number; // minutes
  shortestNonZeroSession: number | null; // minutes, null when no sessions
};

/**
 * Calculates daily worked time and session count series for a date range.
 * Each day returns date key, worked minutes, session count, and optional completed task count.
 * Missing days are filled with zero values so charts do not need to infer gaps.
 * 
 * @param sessions Raw session data from task_sessions table (with tasks relation)
 * @param startDateInclusive Start date (inclusive) in YYYY-MM-DD format
 * @param endDateInclusive End date (inclusive) in YYYY-MM-DD format
 * @param options Optional configuration (now for mocking, includeOpenSessions)
 * @returns Array of daily analytics, one entry per day in range (inclusive)
 */
export function calculateWorkAnalyticsDailySeries(
  sessions: ExecutionEvidenceSessionRow[],
  startDateInclusive: string,
  endDateInclusive: string,
  options: WorkAnalyticsOptions = {}
): WorkAnalyticsDaily[] {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const includeOpenSessions = options.includeOpenSessions ?? false;
  
  // Parse the start and end dates
  const startDate = new Date(startDateInclusive);
  const endDate = new Date(endDateInclusive);
  
  // Validate dates
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }
  
  if (startDate > endDate) {
    throw new Error('Start date must be before or equal to end date');
  }
  
  // Generate all dates in the range (inclusive)
  const dates: string[] = [];
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    dates.push(currentDate.toISOString().split('T')[0]); // YYYY-MM-DD format
    currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000); // Add one day
  }
  
  // Initialize result with zero values for each day
  const result: WorkAnalyticsDaily[] = dates.map(date => ({
    date,
    workedMinutes: 0,
    sessionCount: 0,
    completedTaskCount: undefined,
  }));
  
  if (sessions.length === 0) {
    return result;
  }
  
  // Process each session and distribute its work across the days it spans
  for (const session of sessions) {
    // Skip sessions with no useful timing data
    const sessionStartMs = new Date(session.started_at).getTime();
    const sessionEndMs = session.ended_at 
      ? new Date(session.ended_at).getTime() 
      : new Date(nowIso).getTime(); // Open session uses now as end
    
    // Skip invalid sessions
    if (isNaN(sessionStartMs) || isNaN(sessionEndMs) || sessionEndMs < sessionStartMs) {
      continue;
    }
    
    // Skip open sessions if includeOpenSessions is false
    if (!session.ended_at && !includeOpenSessions) {
      continue;
    }
    
    // Calculate the overlap of this session with each day in our range
    for (let i = 0; i < dates.length; i++) {
      const dayStart = new Date(dates[i]);
      // dayStart is already at 00:00:00.000Z
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1); // next day at 00:00:00.000Z (exclusive)
      
      const dayStartMs = dayStart.getTime();
      const dayEndMs = dayEnd.getTime();
      
      // Calculate overlap between session and this day
      const overlapStartMs = Math.max(sessionStartMs, dayStartMs);
      const overlapEndMs = Math.min(sessionEndMs, dayEndMs);
      
      if (overlapEndMs > overlapStartMs) {
        // There is overlap, calculate the duration in seconds
        const overlapSeconds = Math.floor((overlapEndMs - overlapStartMs) / 1000);
        
        // Add to the day's totals (we'll convert to minutes at the end)
        result[i].workedMinutes += overlapSeconds;
        result[i].sessionCount += 1;
      }
    }
  }
  
  // Convert accumulated seconds to minutes for each day
  for (const day of result) {
    day.workedMinutes = Math.floor(day.workedMinutes / 60);
  }
  
  return result;
}

/**
 * Calculates project breakdown for work analytics.
 * Groups worked minutes and session count by project id/name.
 * Puts missing, deleted, or unknown project refs into a stable `Unknown project` bucket.
 * Sorts breakdown by worked minutes descending, then name/id for stable ties.
 * 
 * @param sessions Raw session data from task_sessions table (with tasks relation)
 * @param window Start and end of the period to analyze (in ISO strings)
 * @param options Optional configuration (now for mocking, includeOpenSessions)
 * @returns Array of project breakdown entries sorted by worked minutes descending
 */
export function calculateWorkAnalyticsProjectBreakdown(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: WorkAnalyticsOptions = {}
): WorkAnalyticsProjectBreakdown[] {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const includeOpenSessions = options.includeOpenSessions ?? false;
  
  // Map to accumulate project data: projectId -> {workedMinutes, sessionCount, projectName}
  const projectMap = new Map<string, { workedMinutes: number; sessionCount: number; projectName: string }>();
  
  // Process each session
  for (const session of sessions) {
    // Calculate tracked seconds for this session within the window
    const trackedSeconds = getExecutionEvidenceSessionOverlapSeconds(
      {
        task_id: session.task_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        duration_seconds: session.duration_seconds,
        tasks: session.tasks
      } as ExecutionEvidenceSessionRow,
      {
        startIso: window.startIso,
        endIso: window.endIso
      } as ExecutionEvidenceWindow,
      {
        nowIso,
        includeOpenSessions
      }
    );
    
    // Skip if no tracked time
    if (trackedSeconds <= 0) {
      continue;
    }
    
    // Determine project ID and name
    let projectId: string | null = null;
    let projectName: string = 'Unknown project';
    
    if (session.tasks?.projects?.name) {
      projectId = session.tasks.projects.id ?? session.tasks.project_id ?? null;
      projectName = session.tasks.projects.name;
    }
    
    // Use projectId as key, or 'unknown' for missing projects
    const key = projectId ?? 'unknown';
    
    // Initialize if not present
    if (!projectMap.has(key)) {
      projectMap.set(key, { workedMinutes: 0, sessionCount: 0, projectName });
    } else {
      // Update existing entry - keep the project name from the first session we saw
      const existing = projectMap.get(key)!;
      projectMap.set(key, {
        workedMinutes: existing.workedMinutes + trackedSeconds,
        sessionCount: existing.sessionCount + 1,
        projectName: existing.projectName
      });
      continue;
    }
    
    // Update project data for new entry
    const projectData = projectMap.get(key)!;
    projectData.workedMinutes += trackedSeconds;
    projectData.sessionCount += 1;
  }
  
  // Convert map to array
  const breakdown: WorkAnalyticsProjectBreakdown[] = [];
  
  for (const [key, data] of projectMap.entries()) {
    // Determine project name and id for the result
    let resultProjectId: string | null = null;
    let resultProjectName: string = data.projectName;
    
    if (key !== 'unknown') {
      // For known projects, use the projectId from the map key
      resultProjectId = key;
    } else {
      // Explicitly unknown project
      resultProjectId = null;
      resultProjectName = 'Unknown project';
    }
    
    breakdown.push({
      projectId: resultProjectId,
      projectName: resultProjectName,
      workedMinutes: Math.floor(data.workedMinutes / 60),
      sessionCount: data.sessionCount
    });
  }
  
  // Sort by worked minutes descending, then by project name for stable ties
  breakdown.sort((a, b) => {
    if (a.workedMinutes !== b.workedMinutes) {
      return b.workedMinutes - a.workedMinutes; // descending
    }
    return a.projectName.localeCompare(b.projectName); // ascending by name
  });
  
  return breakdown;
}

/**
 * Calculates work insights including comparison, streaks, and session quality.
 * 
 * @param sessions Raw session data from task_sessions table (with tasks relation)
 * @param window Start and end of the period to analyze (in ISO strings)
 * @param options Optional configuration (now for mocking, includeOpenSessions)
 * @returns Work analytics insights object
 */
export function calculateWorkAnalyticsInsights(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: WorkAnalyticsOptions = {}
): WorkAnalyticsInsights {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const includeOpenSessions = options.includeOpenSessions ?? false;
  
  // Calculate current period analytics
  const currentPeriod = calculateWorkAnalytics(sessions, window, options);
  
  // Calculate previous period (same duration, immediately before current period)
  const windowStart = new Date(window.startIso);
  const windowEnd = new Date(window.endIso);
  const durationMs = windowEnd.getTime() - windowStart.getTime();
  
  const previousWindow: ExecutionEvidenceWindow = {
    startIso: new Date(windowStart.getTime() - durationMs).toISOString(),
    endIso: windowStart.toISOString()
  };
  
  const previousPeriod = calculateWorkAnalytics(sessions, previousWindow, options);
  
  // Calculate daily series for streak and best/worst day calculations
  // We need to get the date range that covers our window
  const startDate = new Date(window.startIso);
  const endDate = new Date(window.endIso);
  
  // Convert to date strings (YYYY-MM-DD) for the daily series function
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  const dailySeries = calculateWorkAnalyticsDailySeries(sessions, startDateStr, endDateStr, options);
  
  // Calculate period comparison
  const previousWorkedMinutes = previousPeriod.totalWorkedMinutes;
  const deltaMinutes = currentPeriod.totalWorkedMinutes - previousWorkedMinutes;
  const percentChange = previousWorkedMinutes === 0 
    ? (currentPeriod.totalWorkedMinutes > 0 ? Number.POSITIVE_INFINITY : 0)
    : (deltaMinutes / previousWorkedMinutes) * 100;
  
  // Find best day (highest worked minutes)
  let bestDay: WorkAnalyticsDaily | null = null;
  let lowestNonZeroDay: WorkAnalyticsDaily | null = null;
  let daysWorkedCount = 0;
  
  for (const day of dailySeries) {
    if (day.workedMinutes > 0) {
      daysWorkedCount++;
      
      // Update best day
      if (!bestDay || day.workedMinutes > bestDay.workedMinutes) {
        bestDay = day;
      }
      
      // Update lowest non-zero day
      if (!lowestNonZeroDay || day.workedMinutes < lowestNonZeroDay.workedMinutes) {
        lowestNonZeroDay = day;
      }
    }
  }
  
  // Calculate current streak (consecutive days with work up to today)
  // We'll check from today backwards
  const today = new Date(nowIso);
  today.setHours(0, 0, 0, 0);
  let currentStreak = 0;
  
  // Check each day going backwards from today
  let checkDate = new Date(today);
  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    const dayData = dailySeries.find(day => day.date === dateStr);
    
    if (dayData && dayData.workedMinutes > 0) {
      currentStreak++;
      checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000); // Subtract one day
    } else {
      break;
    }
    
    // Prevent infinite loop
    if (currentStreak > 365) break;
  }
  
  // Calculate session quality stats
  // We need to get all session durations within the window
  let totalSessionSeconds = 0;
  let longestSessionSeconds = 0;
  let shortestNonZeroSessionSeconds = Number.POSITIVE_INFINITY;
  let sessionCount = 0;
  
  for (const session of sessions) {
    const trackedSeconds = getExecutionEvidenceSessionOverlapSeconds(
      {
        task_id: session.task_id,
        started_at: session.started_at,
        ended_at: session.ended_at,
        duration_seconds: session.duration_seconds,
        tasks: session.tasks
      } as ExecutionEvidenceSessionRow,
      {
        startIso: window.startIso,
        endIso: window.endIso
      } as ExecutionEvidenceWindow,
      {
        nowIso,
        includeOpenSessions
      }
    );
    
    if (trackedSeconds > 0) {
      totalSessionSeconds += trackedSeconds;
      sessionCount++;
      
      if (trackedSeconds > longestSessionSeconds) {
        longestSessionSeconds = trackedSeconds;
      }
      
      if (trackedSeconds < shortestNonZeroSessionSeconds) {
        shortestNonZeroSessionSeconds = trackedSeconds;
      }
    }
  }
  
  const averageSessionLength = sessionCount > 0 
    ? Math.floor((totalSessionSeconds / sessionCount) / 60) 
    : 0;
  
  const longestSession = Math.floor(longestSessionSeconds / 60);
  const shortestNonZeroSession = shortestNonZeroSessionSeconds === Number.POSITIVE_INFINITY
    ? null
    : Math.floor(shortestNonZeroSessionSeconds / 60);
  
  return {
    // Period comparison
    previousPeriodWorkedMinutes: previousWorkedMinutes,
    deltaMinutes: deltaMinutes,
    percentChange: isFinite(percentChange) ? percentChange : null,
    
    // Best/worst days
    bestDay: bestDay ?? null,
    lowestNonZeroDay: lowestNonZeroDay ?? null,
    daysWorkedCount: daysWorkedCount,
    currentStreak: currentStreak,
    
    // Session quality
    averageSessionLength,
    longestSession,
    shortestNonZeroSession
  };
}
