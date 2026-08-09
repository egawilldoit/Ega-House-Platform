import * as Sentry from "@sentry/nextjs";

type CaptureServerExceptionOptions = {
  area: string;
  operation?: string;
  extras?: Record<string, unknown>;
};

export function captureServerException(
  error: unknown,
  options: CaptureServerExceptionOptions,
) {
  const normalizedError =
    error instanceof Error
      ? error
      : new Error(
          typeof error === "string" ? error : "Unexpected server error",
        );

  Sentry.withScope((scope) => {
    scope.setTag("error_area", options.area);

    if (options.operation) {
      scope.setTag("error_operation", options.operation);
    }

    if (options.extras) {
      scope.setContext("error_metadata", options.extras);
    }

    Sentry.captureException(normalizedError);
  });
}
