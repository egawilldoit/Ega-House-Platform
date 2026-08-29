export type TimeContextFallback = "none" | "invalid_timezone" | "missing_timezone";

export type TimeContextDayWindowDto = Readonly<{
  date: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  startUtc: string;
  endUtc: string;
  durationHours: number;
}>;

export type TimeContextWeekWindowDto = Readonly<{
  date: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  weekStart: string;
  weekEnd: string;
  weekStartUtc: string;
  weekEndExclusiveUtc: string;
}>;

export type TimeContextDto = Readonly<{
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  localDate: string;
  dayWindow: TimeContextDayWindowDto;
  weekWindow: TimeContextWeekWindowDto;
}>;

export type GetTimeContextResponse = Readonly<{
  ok: true;
  timeContext: TimeContextDto;
}>;

export type SetTimeContextRequest = Readonly<{
  timezone: string;
}>;

export type SetTimeContextResponse = Readonly<{
  ok: true;
  timezone: string;
}>;
