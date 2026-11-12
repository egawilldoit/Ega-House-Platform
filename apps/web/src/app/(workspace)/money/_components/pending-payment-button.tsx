"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for the MONEY-07 payment forms. The pending state is real:
 * the button is disabled and says what is happening while the atomic
 * payment, correction or undo is in flight.
 */
export function PendingPaymentButton({
  children,
  pendingLabel = "Working...",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className="self-start rounded border border-ega-border px-4 py-2 disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
