"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function SentrySmokeTestTrigger() {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error(
      "TEMP_SENTRY_SMOKE_TEST: Intentional client error from /dashboard/sentry-smoke-test. Remove this route after verification.",
    );
  }

  return (
    <Button variant="danger" onClick={() => setShouldThrow(true)}>
      Trigger temporary Sentry error
    </Button>
  );
}
