"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

import { stopTimerAction } from "@/app/timer/actions";
import { Button } from "@/components/ui/button";

type TimerStopFormProps = {
  sessionId: string;
  returnTo: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  children?: ReactNode;
};

function TimerStopSubmitButton({
  disabled,
  size,
  className,
  children,
}: Omit<TimerStopFormProps, "sessionId" | "returnTo">) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size={size}
      variant="danger"
      disabled={disabled || pending}
      className={className}
    >
      {pending ? "Stopping..." : children ?? "Stop timer"}
    </Button>
  );
}

export function TimerStopForm({
  sessionId,
  returnTo,
  disabled = false,
  size,
  className,
  children,
}: TimerStopFormProps) {
  return (
    <form action={stopTimerAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <TimerStopSubmitButton
        disabled={disabled}
        size={size}
        className={className}
      >
        {children}
      </TimerStopSubmitButton>
    </form>
  );
}
