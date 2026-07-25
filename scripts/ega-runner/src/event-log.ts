import type postgres from "postgres";

export interface EventRecord {
  id: bigint;
  run_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Persist an implementation event.
 * The `id` column is GENERATED ALWAYS AS IDENTITY — do not specify it.
 */
export async function insertEvent(
  db: postgres.Sql<{}>,
  runId: string,
  eventType: string,
  payload: // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
): Promise<EventRecord> {
  const rows = await db`
    INSERT INTO automation.implementation_events (run_id, event_type, payload)
    VALUES (${runId}::uuid, ${eventType}, ${db.json(payload)})
    RETURNING id, run_id, event_type, payload, created_at
  `;

  return rows[0] as EventRecord;
}
