import type { MobileTodaySummary, MobileTodayTaskItem } from "./mobile";

export type OperatorSignalsDto = Readonly<{
  health: unknown | null;
  friction: unknown | null;
  inbox: unknown | null;
  weeklyObjective: unknown | null;
}>;

export type OperatorFocusDto = Readonly<{
  startHere: MobileTodayTaskItem | null;
  queue: MobileTodayTaskItem[];
}>;

export type OperatorScheduleDto = Readonly<{
  blocks: MobileTodayTaskItem[];
  flexible: MobileTodayTaskItem[];
}>;

export type OperatorSnapshotDto = Readonly<{
  ok: true;
  date: string;
  sections: Readonly<{
    planned: MobileTodayTaskItem[];
    inProgress: MobileTodayTaskItem[];
    blocked: MobileTodayTaskItem[];
    completed: MobileTodayTaskItem[];
  }>;
  focus: OperatorFocusDto;
  schedule: OperatorScheduleDto;
  suggestions: Readonly<{
    pinned: MobileTodayTaskItem[];
    inProgress: MobileTodayTaskItem[];
  }>;
  summary: MobileTodaySummary;
  activeTimer: Readonly<{ sessionId: string; taskId: string }> | null;
  signals: OperatorSignalsDto;
}>;

export type GetOperatorSnapshotResponse = OperatorSnapshotDto;
