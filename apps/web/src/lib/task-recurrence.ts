export {
  DEFAULT_TASK_RECURRENCE_TIMEZONE,
  TASK_RECURRENCE_RULE_VALUES,
  getFirstTaskRecurrenceDateAfter,
  getNextTaskRecurrenceDate,
  getNextTaskRecurrenceDateFromAnchor,
  isTaskRecurrenceRule,
  isValidTaskRecurrenceAnchorDate,
  isValidTaskRecurrenceTimezone,
  normalizeTaskRecurrenceAnchorDateInput,
  normalizeTaskRecurrenceRuleInput,
  normalizeTaskRecurrenceScheduleInput,
  normalizeTaskRecurrenceTimezoneInput,
} from "@ega/domain/tasks";
export type { TaskRecurrenceRule } from "@ega/domain/tasks";

export function formatTaskRecurrenceRule(rule: string | null | undefined) {
  if (!rule) return "Does not repeat";
  if (rule === "daily") return "Daily";
  if (rule === "weekdays") return "Weekdays";
  if (rule === "monthly:day-of-month") return "Monthly";

  if (rule.startsWith("weekly:")) {
    const weekday = rule.slice("weekly:".length);
    return `Weekly ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  }

  return rule;
}
