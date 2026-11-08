/**
 * Shared contract for the verified timer reconcile Server Function.
 *
 * Kept in a directive-free module so both the server action and the client
 * status component can import the same wire shape without pulling the server
 * implementation into the client bundle.
 */

export type TimerReconcileSurface = "timer" | "today";

export type TimerReconcileResult =
  | {
      ok: true;
      /** Server-observed instant that produced this confirmed state. */
      syncedAt: string;
      /** Only the identifier, never task titles or owner data. */
      activeSessionId: string | null;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "unavailable";
      message: string;
    };
