import type postgres from "postgres";

export interface QueueMessage {
  msg_id: bigint;
  read_ct: number;
  enqueued_at: Date;
  vt: Date;
  message: Record<string, unknown>;
  headers: Record<string, unknown> | null;
}

/**
 * Read one visible message from the queue with a visibility timeout.
 * Returns null if no message is available.
 */
export async function readMessage(
  db: postgres.Sql<{}>,
  queueName: string,
  visibilityTimeoutSeconds: number,
): Promise<QueueMessage | null> {
  const rows = await db`
    SELECT * FROM pgmq.read(
      ${queueName},
      ${visibilityTimeoutSeconds}::integer,
      1
    )
  `;

  if (!rows || rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    msg_id: row.msg_id,
    read_ct: row.read_ct,
    enqueued_at: row.enqueued_at,
    vt: row.vt,
    message: typeof row.message === "string"
      ? JSON.parse(row.message)
      : (row.message ?? {}),
    headers: typeof row.headers === "string"
      ? JSON.parse(row.headers)
      : (row.headers ?? null),
  };
}

/**
 * Extend the visibility timeout on a queue message.
 */
export async function setVisibilityTimeout(
  db: postgres.Sql<{}>,
  queueName: string,
  msgId: bigint,
  visibilityTimeoutSeconds: number,
): Promise<void> {
  const result = await db`
    SELECT pgmq.set_vt(
      ${queueName},
      ${Number(msgId)}::bigint,
      ${visibilityTimeoutSeconds}::integer
    ) AS ok
  `;
  // pgmq.set_vt returns true on success
  if (!result[0]?.ok) {
    throw new Error(
      `pgmq.set_vt returned false for msg_id=${msgId}`,
    );
  }
}

/**
 * Archive (safe delete) a queue message after successful completion.
 */
export async function archiveMessage(
  db: postgres.Sql<{}>,
  queueName: string,
  msgId: bigint,
): Promise<void> {
  const result = await db`
    SELECT pgmq.archive(
      ${queueName},
      ${Number(msgId)}::bigint
    ) AS ok
  `;
  if (result[0]?.ok === null || result[0]?.ok === undefined) {
    throw new Error(
      `pgmq.archive returned no row for msg_id=${msgId}`,
    );
  }
  // pgmq.archive returns the msg_id on success, null if not found
  if (result[0]?.ok === null) {
    throw new Error(
      `pgmq.archive: message ${msgId} not found in queue ${queueName}`,
    );
  }
}
